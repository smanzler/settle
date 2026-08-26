import { z } from "zod";
import { allocate, equalParts, MAX_WEIGHT } from "./money";

/**
 * The `bigint` column has room for far more, but every amount is handled as a
 * `number` in TS and multiplied by a weight of up to `MAX_WEIGHT` inside
 * `allocate` — 1e12 × 1000 = 1e15, still under 2^53.
 */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000;

const memberIdSchema = z.uuid();

const isDistinct = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Who fronted the money. Several payers on one expense is ordinary. */
export const payerSchema = z.object({
  memberId: memberIdSchema,
  amountCents: z.int().positive().max(MAX_AMOUNT_CENTS),
});

export type Payer = z.infer<typeof payerSchema>;

/**
 * How an amount is divided, as the user expressed it.
 *
 * A discriminated union rather than three optional fields, because the three
 * modes need genuinely different data and "weights present but amounts also
 * present" must not be representable. What gets *stored* is neither of these —
 * it is the cents `buildShares` resolves them to, once, at write time.
 */
export const splitSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("equal"),
    memberIds: z.array(memberIdSchema).min(1).refine(isDistinct, {
      message: "A member can only appear once in a split",
    }),
  }),
  z.object({
    mode: z.literal("weights"),
    parts: z
      .array(
        z.object({
          memberId: memberIdSchema,
          weight: z.int().min(1).max(MAX_WEIGHT),
        }),
      )
      .min(1)
      .refine((parts) => isDistinct(parts.map((part) => part.memberId)), {
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
 * ledger that carries it. Lives in `shared` for the same reason `allocate`
 * does — the editor previews the exact numbers the server is about to store.
 *
 * Throws on an `exact` split that does not add up. That is a user-facing
 * condition, not an internal one: the editor keeps Save disabled until the
 * remainder is zero, and this is the backstop that makes the invariant true
 * rather than merely likely.
 */
export const buildShares = (amountCents: number, split: Split): Share[] => {
  switch (split.mode) {
    case "equal":
      return toShares(allocate(amountCents, equalParts(split.memberIds)));
    case "weights":
      return toShares(allocate(amountCents, split.parts));
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

const toShares = (allocated: Map<string, number>): Share[] =>
  [...allocated].map(([memberId, amountCents]) => ({ memberId, amountCents }));

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
