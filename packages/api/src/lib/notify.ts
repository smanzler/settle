import { eq } from "drizzle-orm";
import db from "../db";
import {
  NotificationDeliveries,
  Notifications,
  PushTokens,
} from "../db/schema";
import {
  fromCents,
  notificationPayloadSchema,
  type NotificationPayload,
} from "@budget/shared";

const renderNotification = (
  payload: NotificationPayload,
): { title: string; body: string } => {
  switch (payload.type) {
    case "system_message":
      return { title: "Budget", body: payload.data.message };
    case "bank_login_required":
      return {
        title: payload.data.institutionName ?? "Bank connection expired",
        body: "Reconnect to keep your transactions up to date.",
      };
    case "settlement_recorded":
      return {
        title: "Payment recorded",
        body: `${payload.data.fromDisplayName} says they paid you ${formatMoney(
          payload.data.amountCents,
          payload.data.isoCurrencyCode,
        )}.`,
      };
    case "settlement_voided":
      return {
        title: "Payment voided",
        body: `${payload.data.voidedByDisplayName} took back a ${formatMoney(
          payload.data.amountCents,
          payload.data.isoCurrencyCode,
        )} payment.`,
      };
  }
};

/**
 * `4000` → `USD 40.00`.
 *
 * The code rather than a symbol: this string is frozen into `notifications.body`
 * at write time, so it has to be unambiguous years later and in whatever
 * currency the household chose, and a bare `$` is neither.
 */
const formatMoney = (cents: number, currency: string) =>
  `${currency} ${fromCents(Math.abs(cents))}`;

/**
 * Hands a delivery to the worker, importing the queue only when there is
 * something to send.
 *
 * A static `import { boss }` would be simpler and is wrong: `lib/boss.ts` calls
 * `boss.start()` at module scope, so importing it anywhere connects to Postgres
 * and spins up a job queue as a side effect of loading a file. That is what
 * `routes/scope.test.ts` documents at the top of itself and hand-composes its
 * router to avoid — and every router that notifies would otherwise drag the
 * queue into the test process, where the whole suite dies on connect before a
 * single assertion runs.
 */
const enqueue = async (deliveryId: string) => {
  const { boss } = await import("./boss");

  await boss.send("notify.mobile", { deliveryId });
};

export const notify = async ({
  userId,
  payload,
  dedupeKey,
}: {
  userId: string;
  payload: NotificationPayload;
  dedupeKey?: string;
}) => {
  const parsed = notificationPayloadSchema.parse(payload);
  const { title, body } = renderNotification(parsed);

  const [notification] = await db
    .insert(Notifications)
    .values({
      userId,
      type: parsed.type,
      data: parsed.data,
      title,
      body,
      dedupeKey,
    })
    .onConflictDoNothing({
      target: [Notifications.userId, Notifications.dedupeKey],
    })
    .returning();

  if (!notification) return null; // duplicate event — already notified, no-op

  const tokens = await db
    .select()
    .from(PushTokens)
    .where(eq(PushTokens.userId, userId));

  for (const token of tokens) {
    const { token: deviceToken } = token;

    const [delivery] = await db
      .insert(NotificationDeliveries)
      .values({
        notificationId: notification.id,
        channel: "mobile",
        deviceToken,
      })
      .returning();

    if (!delivery) throw new Error();

    await enqueue(delivery.id);
  }

  return notification;
};
