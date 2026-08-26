import { z } from "zod";

/**
 * Somebody claimed they paid you back.
 *
 * The one adversarial write in the app: `settlements.create` forces
 * `from_member_id` to the caller, so the only assertion anyone can make is "I
 * paid you" — the one that reduces their own balance. Telling the payee is what
 * makes that claim reviewable rather than silent.
 *
 * `amountCents` travels rather than a formatted string so the renderer owns the
 * money formatting, and `groupId` travels so a tap can switch to the group the
 * payment happened in.
 */
export const settlementRecordedSchema = z.object({
  type: z.literal("settlement_recorded"),
  data: z.object({
    settlementId: z.string(),
    groupId: z.string(),
    /** The payer's seat name — the payee may not know their user account. */
    fromDisplayName: z.string(),
    amountCents: z.number().int(),
    isoCurrencyCode: z.string(),
  }),
});

/**
 * A repayment was taken back.
 *
 * Void is scoped to the settlement's author *or* any group owner, so an owner
 * can reverse a payment somebody else recorded. Without this the other party's
 * balance silently moves back.
 */
export const settlementVoidedSchema = z.object({
  type: z.literal("settlement_voided"),
  data: z.object({
    settlementId: z.string(),
    groupId: z.string(),
    /** Who voided it, which is not necessarily who recorded it. */
    voidedByDisplayName: z.string(),
    amountCents: z.number().int(),
    isoCurrencyCode: z.string(),
  }),
});

/**
 * Every payload the API can send, discriminated on `type`.
 *
 * Add a variant here and `renderNotification` in `packages/api/src/lib/notify.ts`
 * is what fails to compile first — its switch has no `default`, so a new variant
 * cannot ship without a title and body. Clients narrow on the same `type` when
 * handling a tap.
 */
export const notificationPayloadSchema = z.discriminatedUnion("type", [
  settlementRecordedSchema,
  settlementVoidedSchema,
]);

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
