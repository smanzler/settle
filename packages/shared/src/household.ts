import { z } from "zod";

/**
 * `household.invite`'s input.
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
