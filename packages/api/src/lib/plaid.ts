import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { z } from "zod";
import { env } from "../env";

// PlaidEnvironments is declared with an index signature, so the lookup is
// `string | undefined` — narrow it once here rather than asserting.
const basePath = PlaidEnvironments[env.PLAID_ENV];
if (!basePath) throw new Error(`Unknown PLAID_ENV: ${env.PLAID_ENV}`);

export const plaid = new PlaidApi(
  new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
        "PLAID-SECRET": env.PLAID_SECRET,
      },
    },
  }),
);

const plaidErrorSchema = z.object({
  response: z.object({ data: z.object({ error_code: z.string() }) }),
});

/**
 * Plaid errors arrive as axios errors with the useful part buried in
 * `response.data`. Returns the Plaid `error_code` (e.g. `ITEM_LOGIN_REQUIRED`)
 * or null if this wasn't a Plaid API error.
 */
export const plaidErrorCode = (err: unknown): string | null => {
  const parsed = plaidErrorSchema.safeParse(err);

  return parsed.success ? parsed.data.response.data.error_code : null;
};
