import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";
import { relations } from "../db/relations";
import {
  BankAccounts,
  HouseholdMembers,
  Households,
  LedgerEntries,
  TransactionSplits,
  Transactions,
  PlaidItems,
  users,
} from "../db/schema";
import { postShareDeltas, shareRef, verifyLedger } from "./ledger";

/**
 * These exercise real SQL — a full outer join, an upsert-free append, and an
 * aggregate — so a mock would only test the mock. They need a live Postgres
 * with the migrations applied, which CI does not have, so they are opt-in:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://budget:...@localhost:5432/budget pnpm test
 *
 * Every test runs inside a transaction that is always rolled back, so pointing
 * this at a development database does not write to it.
 */
const url = process.env.INTEGRATION_DATABASE_URL;

const db = url ? drizzle(url, { relations }) : null;

afterAll(async () => {
  await db?.$client.end();
});

const ROLLBACK = Symbol("rollback");

/** Runs `body` against a scratch household, then rolls the whole thing back. */
const inScratchHousehold = async (
  body: (ctx: {
    tx: Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0];
    householdId: string;
    simon: string;
    ana: string;
    charge: { id: string; ref: string };
    refund: { id: string; ref: string };
  }) => Promise<void>,
) => {
  if (!db) throw new Error("no database");

  try {
    await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(Households)
        .values({ name: "ledger test" })
        .returning();
      const [simon] = await tx
        .insert(HouseholdMembers)
        .values({
          householdId: household!.id,
          displayName: "Simon",
          role: "owner",
          status: "active",
        })
        .returning();
      const [ana] = await tx
        .insert(HouseholdMembers)
        .values({
          householdId: household!.id,
          displayName: "Ana",
          status: "active",
        })
        .returning();

      // plaid_items.user_id is a real FK; any user will do for a scratch row.
      const [user] = await tx.select({ id: users.id }).from(users).limit(1);
      const [item] = await tx
        .insert(PlaidItems)
        .values({
          householdId: household!.id,
          userId: user!.id,
          ownerMemberId: simon!.id,
          plaidItemId: `test-${household!.id}`,
          accessToken: "x",
        })
        .returning();
      const [account] = await tx
        .insert(BankAccounts)
        .values({
          householdId: household!.id,
          plaidItemId: item!.id,
          ownerMemberId: simon!.id,
          plaidAccountId: `acct-${household!.id}`,
          name: "Amex",
        })
        .returning();

      const make = async (suffix: string, amount: string, date: string) => {
        const [row] = await tx
          .insert(Transactions)
          .values({
            householdId: household!.id,
            bankAccountId: account!.id,
            creditorMemberId: simon!.id,
            plaidTransactionId: `ptx-${household!.id}-${suffix}`,
            amount,
            date,
            name: "Luigi's",
            isoCurrencyCode: "USD",
          })
          .returning();

        return { id: row!.id, ref: shareRef(row!.plaidTransactionId) };
      };

      await body({
        tx,
        householdId: household!.id,
        simon: simon!.id,
        ana: ana!.id,
        charge: await make("charge", "100.00", "2026-08-03"),
        refund: await make("refund", "-100.00", "2026-09-12"),
      });

      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
};

describe.skipIf(!url)("postShareDeltas", () => {
  it("posts, is idempotent, and only ever appends the difference", async () => {
    await inScratchHousehold(async (ctx) => {
      const post = (cents: number | null) =>
        postShareDeltas(ctx.tx, {
          householdId: ctx.householdId,
          targets: [
            {
              externalRef: ctx.charge.ref,
              transactionId: ctx.charge.id,
              memo: "Luigi's",
              effectiveDate: "2026-08-03",
              isoCurrencyCode: "USD",
              pairs:
                cents === null
                  ? []
                  : [
                      {
                        debtorMemberId: ctx.ana,
                        creditorMemberId: ctx.simon,
                        cents,
                      },
                    ],
            },
          ],
        });

      // Deliberately order-independent: `created_at` defaults to now(), which
      // in Postgres is transaction-start time, so every entry written inside
      // one transaction shares it and the uuid tiebreak is arbitrary. What
      // matters is that rows are only ever added and the total lands on target.
      const amounts = async () =>
        (
          await ctx.tx
            .select()
            .from(LedgerEntries)
            .where(eq(LedgerEntries.householdId, ctx.householdId))
        )
          .map((entry) => entry.amountCents)
          .sort((a, b) => a - b);

      const total = async () =>
        (await amounts()).reduce((sum, cents) => sum + cents, 0);

      await post(5000);
      expect(await amounts()).toEqual([5000]);

      // The property the whole design rests on.
      await post(5000);
      expect(await amounts()).toEqual([5000]);

      // An edit appends the delta rather than rewriting history.
      await post(3000);
      expect(await amounts()).toEqual([-2000, 5000]);
      expect(await total()).toBe(3000);

      await post(5000);
      expect(await amounts()).toEqual([-2000, 2000, 5000]);
      expect(await total()).toBe(5000);

      // A Plaid delete: reverse to exactly zero, without deleting anything.
      await post(null);
      expect(await total()).toBe(0);
      expect(await amounts()).toHaveLength(4);
    });
  });

  it("nets a refund against its charge through the sign alone", async () => {
    await inScratchHousehold(async (ctx) => {
      await postShareDeltas(ctx.tx, {
        householdId: ctx.householdId,
        targets: [
          {
            externalRef: ctx.charge.ref,
            transactionId: ctx.charge.id,
            memo: "Luigi's",
            effectiveDate: "2026-08-03",
            isoCurrencyCode: "USD",
            pairs: [
              {
                debtorMemberId: ctx.ana,
                creditorMemberId: ctx.simon,
                cents: 5000,
              },
            ],
          },
          {
            externalRef: ctx.refund.ref,
            transactionId: ctx.refund.id,
            memo: "Luigi's refund",
            effectiveDate: "2026-09-12",
            isoCurrencyCode: "USD",
            pairs: [
              {
                debtorMemberId: ctx.ana,
                creditorMemberId: ctx.simon,
                cents: -5000,
              },
            ],
          },
        ],
      });

      const [net] = await ctx.tx
        .select({ sum: sql<string>`sum(${LedgerEntries.amountCents})::text` })
        .from(LedgerEntries)
        .where(eq(LedgerEntries.householdId, ctx.householdId));

      expect(net!.sum).toBe("0");
    });
  });

  it("reverses only the ref it was told about", async () => {
    await inScratchHousehold(async (ctx) => {
      const target = (
        ref: string,
        transactionId: string,
        date: string,
        cents: number | null,
      ) => ({
        externalRef: ref,
        transactionId,
        memo: "Luigi's",
        effectiveDate: date,
        isoCurrencyCode: "USD",
        pairs:
          cents === null
            ? []
            : [
                {
                  debtorMemberId: ctx.ana,
                  creditorMemberId: ctx.simon,
                  cents,
                },
              ],
      });

      await postShareDeltas(ctx.tx, {
        householdId: ctx.householdId,
        targets: [
          target(ctx.charge.ref, ctx.charge.id, "2026-08-03", 5000),
          target(ctx.refund.ref, ctx.refund.id, "2026-09-12", -5000),
        ],
      });

      await postShareDeltas(ctx.tx, {
        householdId: ctx.householdId,
        targets: [target(ctx.charge.ref, ctx.charge.id, "2026-08-03", null)],
      });

      const sums = await ctx.tx
        .select({
          ref: LedgerEntries.externalRef,
          sum: sql<string>`sum(${LedgerEntries.amountCents})::text`,
        })
        .from(LedgerEntries)
        .where(eq(LedgerEntries.householdId, ctx.householdId))
        .groupBy(LedgerEntries.externalRef);

      expect(Object.fromEntries(sums.map((row) => [row.ref, row.sum]))).toEqual(
        {
          [ctx.charge.ref]: "0",
          [ctx.refund.ref]: "-5000",
        },
      );
    });
  });
});

describe.skipIf(!url)("verifyLedger", () => {
  it("detects a split that was never posted, and converges in one call", async () => {
    await inScratchHousehold(async (ctx) => {
      await ctx.tx.insert(TransactionSplits).values([
        {
          householdId: ctx.householdId,
          transactionId: ctx.charge.id,
          memberId: ctx.simon,
          weight: 1,
          amountCents: 5000,
        },
        {
          householdId: ctx.householdId,
          transactionId: ctx.charge.id,
          memberId: ctx.ana,
          weight: 1,
          amountCents: 5000,
        },
      ]);

      const drift = await verifyLedger(ctx.householdId, ctx.tx);

      expect(drift).toEqual([
        {
          externalRef: ctx.charge.ref,
          debtorMemberId: ctx.ana,
          creditorMemberId: ctx.simon,
          targetCents: 5000,
          postedCents: 0,
          // The transaction is still here — this is a genuinely missed post,
          // not a ref left behind by a purge.
          detached: false,
        },
      ]);

      await postShareDeltas(ctx.tx, {
        householdId: ctx.householdId,
        targets: [
          {
            externalRef: ctx.charge.ref,
            transactionId: ctx.charge.id,
            memo: "Luigi's",
            effectiveDate: "2026-08-03",
            isoCurrencyCode: "USD",
            pairs: [
              {
                debtorMemberId: ctx.ana,
                creditorMemberId: ctx.simon,
                cents: 5000,
              },
            ],
          },
        ],
      });

      expect(await verifyLedger(ctx.householdId, ctx.tx)).toEqual([]);
    });
  });
});
