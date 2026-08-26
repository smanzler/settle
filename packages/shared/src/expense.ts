import { z } from "zod";

/**
 * The `bigint` column has room for far more; this is the bound that keeps every
 * amount a safe integer in TS, where all the arithmetic happens.
 */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000;

const memberIdSchema = z.uuid();

const isDistinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Who fronted the money. Several payers on one expense is ordinary. */
const payerSchema = z.object({
  memberId: memberIdSchema,
  amountCents: z.int().positive().max(MAX_AMOUNT_CENTS),
});

export type Payer = z.infer<typeof payerSchema>;

/**
 * How an amount is divided, as the user expressed it.
 *
 * A discriminated union rather than optional fields, because the two modes need
 * genuinely different data and "a member list and a set of amounts, both" must
 * not be representable. What gets *stored* is neither — it is the cents
 * `buildShares` resolves them to, once, at write time.
 */
export const splitSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("equal"),
    memberIds: z.array(memberIdSchema).min(1).refine(isDistinct, {
      message: "A member can only appear once in a split",
    }),
  }),
  z.object({
    mode: z.literal("exact"),
    parts: z
      .array(
        z.object({
          memberId: memberIdSchema,
          /** Zero is legal — "you were there, you don't owe anything". */
          amountCents: z.int().min(0).max(MAX_AMOUNT_CENTS),
        }),
      )
      .min(1)
      .refine((parts) => isDistinct(parts.map((part) => part.memberId)), {
        message: "A member can only appear once in a split",
      }),
  }),
]);

export type Split = z.infer<typeof splitSchema>;

/** A member's slice, resolved to cents. This is what the database stores. */
export type Share = { memberId: string; amountCents: number };

export const sumAmounts = (parts: readonly { amountCents: number }[]) =>
  parts.reduce((total, part) => total + part.amountCents, 0);

/**
 * A split, resolved to exact cents.
 *
 * The one place rounding is decided, and it is decided **once, at write time**:
 * nothing downstream ever divides again, so a share can never disagree with the
 * ledger that carries it. Lives in `shared` so the editor previews the exact
 * numbers the server is about to store.
 *
 * Throws on an `exact` split that does not add up. That is a user-facing
 * condition, not an internal one: the editor keeps Save disabled until the
 * remainder is zero, and this is the backstop that makes the invariant true
 * rather than merely likely.
 */
export const buildShares = (amountCents: number, split: Split): Share[] => {
  switch (split.mode) {
    case "equal":
      return splitEqually(amountCents, split.memberIds);
    case "exact": {
      const total = sumAmounts(split.parts);

      if (total !== amountCents) {
        throw new Error(
          `exact split does not add up: parts sum to ${total}, amount is ${amountCents}`,
        );
      }

      return split.parts.map((part) => ({
        memberId: part.memberId,
        amountCents: part.amountCents,
      }));
    }
  }
};

/**
 * Divides an amount evenly, exactly.
 *
 * Integer-divide, then hand the remaining cents out one at a time. Two
 * properties everything downstream depends on: the results always sum to
 * `totalCents`, and the same input always resolves the same way — so the
 * editor's preview, the server's write and every later revision agree to the
 * cent.
 *
 * The odd cents go to the lowest member ids, compared with `<` rather than
 * `localeCompare`, which is locale- and ICU-dependent and can differ between the
 * phone and the server. The cost is that the lowest id always absorbs it;
 * rotating for fairness would cost the determinism, which is not a trade worth
 * making.
 */
const splitEqually = (
  totalCents: number,
  memberIds: readonly string[],
): Share[] => {
  const base = Math.floor(totalCents / memberIds.length);
  const leftover = totalCents - base * memberIds.length;

  const takesAnExtraCent = new Set(
    [...memberIds].sort((a, b) => (a < b ? -1 : 1)).slice(0, leftover),
  );

  return memberIds.map((memberId) => ({
    memberId,
    amountCents: base + (takesAnExtraCent.has(memberId) ? 1 : 0),
  }));
};

/**
 * The body of `expenses.create` and `expenses.revise` alike — a revision states
 * the whole expense again rather than patching it, because a version *is* the
 * whole expense.
 *
 * The payer total is checked here so the same rule guards the form and the
 * procedure. The share total is not: `buildShares` resolves two of the three
 * modes and can only be checked after it runs.
 */
export const expenseInputSchema = z
  .object({
    amountCents: z.int().positive().max(MAX_AMOUNT_CENTS),
    description: z.string().trim().min(1).max(120),
    expenseDate: z.iso.date(),
    /** Why this revision exists — "tip posted", "Carol wasn't there". */
    note: z.string().trim().max(500).nullish(),
    payers: z
      .array(payerSchema)
      .min(1)
      .refine((payers) => isDistinct(payers.map((payer) => payer.memberId)), {
        message: "A member can only pay once for an expense",
      }),
    split: splitSchema,
  })
  .refine((input) => sumAmounts(input.payers) === input.amountCents, {
    message: "What the payers put in has to add up to the total",
    path: ["payers"],
  });

export type ExpenseInput = z.infer<typeof expenseInputSchema>;
