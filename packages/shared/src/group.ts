import { z } from "zod";

export const groupNameSchema = z.string().trim().min(1).max(80);

/**
 * ISO 4217, uppercased here rather than trusted. The code is compared for
 * equality in a few places, so a lowercase 'usd' would silently match nothing.
 */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like USD");

/**
 * `groups.invite`'s input.
 *
 * Shared so the invite form can refuse a malformed address before it costs a
 * round trip, against the same rule the procedure enforces. Values arrive
 * trimmed — the procedure lowercases the address on top of this.
 */
export const inviteInputSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(1).max(80),
});

export type InviteInput = z.infer<typeof inviteInputSchema>;
