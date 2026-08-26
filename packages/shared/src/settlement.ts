import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "./expense";

/**
 * `settlements.create`'s input.
 *
 * There is no `fromMemberId`: the procedure forces it to the caller's own seat,
 * so the only claim anybody can make is "I paid you" — the one that reduces
 * their own balance. Asserting somebody else paid you is not expressible.
 */
export const settlementInputSchema = z.object({
  toMemberId: z.uuid(),
  amountCents: z.int().positive().max(MAX_AMOUNT_CENTS),
  /** Free text: 'cash', 'venmo', 'zelle'. */
  method: z.string().trim().max(40).nullish(),
  note: z.string().trim().max(500).nullish(),
  settledOn: z.iso.date(),
});

export type SettlementInput = z.infer<typeof settlementInputSchema>;
