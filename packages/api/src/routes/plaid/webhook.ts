import { createHash, timingSafeEqual } from "node:crypto";
import { type FastifyPluginCallback } from "fastify";
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type CryptoKey,
} from "jose";
import { z } from "zod";
import db from "../../db";
import { enqueuePlaidSync } from "../../lib/plaid-queue";
import { plaid } from "../../lib/plaid";
import { markLoginRequired } from "../../lib/plaid-sync";

declare module "fastify" {
  interface FastifyRequest {
    /** Set only on routes registered by this plugin. */
    rawBody?: Buffer;
  }
}

/** Plaid's signing keys rotate but never change meaning, so cache by `kid`. */
const keyCache = new Map<string, CryptoKey | Uint8Array>();

const getVerificationKey = async (kid: string) => {
  const cached = keyCache.get(kid);
  if (cached) return cached;

  const { data } = await plaid.webhookVerificationKeyGet({ key_id: kid });

  if (data.key.expired_at !== null) {
    throw new Error(`Plaid verification key ${kid} is expired`);
  }

  // Only the JWK fields — Plaid also returns created_at/expired_at, which are
  // not part of the key material.
  const { alg, crv, kty, use, x, y } = data.key;
  const key = await importJWK({ alg, crv, kty, use, x, y }, "ES256");
  keyCache.set(kid, key);

  return key;
};

const claimsSchema = z.object({
  request_body_sha256: z.string(),
});

/**
 * The webhook has no auth hook — Plaid calls it — so this signature check *is*
 * the security boundary. Verify before trusting a single field of the body.
 */
const verifyWebhook = async (token: string, rawBody: Buffer) => {
  const header = decodeProtectedHeader(token);

  // Pin the algorithm before touching the token: an unpinned `alg` is the
  // classic JWT confusion attack.
  if (header.alg !== "ES256" || !header.kid) return false;

  const key = await getVerificationKey(header.kid);

  const { payload } = await jwtVerify(token, key, {
    algorithms: ["ES256"],
    // Plaid documents a 5-minute replay window.
    maxTokenAge: "5 minutes",
  });

  const { request_body_sha256 } = claimsSchema.parse(payload);
  const actual = createHash("sha256").update(rawBody).digest("hex");

  const expected = Buffer.from(request_body_sha256, "hex");
  const digest = Buffer.from(actual, "hex");

  return expected.length === digest.length && timingSafeEqual(expected, digest);
};

const webhookSchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().optional(),
  error: z.object({ error_code: z.string() }).nullish(),
});

/** Webhook codes that mean "there is new transaction data to pull". */
const SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
]);

export const plaidWebhookRoutes: FastifyPluginCallback = async (fastify) => {
  // Scoped to this plugin by Fastify's encapsulation. The raw bytes are
  // required — `JSON.stringify(parsedBody)` will not reliably reproduce them,
  // and the signature covers the bytes Plaid actually sent.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      try {
        done(null, JSON.parse(body.toString("utf8")) as unknown);
      } catch {
        done(null, undefined);
      }
    },
  );

  fastify.route({
    method: "POST",
    url: "/webhooks/plaid",
    async handler(request, reply) {
      const token = request.headers["plaid-verification"];
      const rawBody = request.rawBody;

      if (typeof token !== "string" || !rawBody) {
        return reply.status(400).send({ error: "Missing verification" });
      }

      try {
        if (!(await verifyWebhook(token, rawBody))) {
          return reply.status(400).send({ error: "Invalid verification" });
        }
      } catch (err) {
        console.error("Plaid webhook verification failed:", err);
        return reply.status(400).send({ error: "Invalid verification" });
      }

      const parsed = webhookSchema.safeParse(request.body);
      if (!parsed.success || !parsed.data.item_id) {
        // Recognized delivery, nothing for us to do. 200 so Plaid stops retrying.
        return reply.status(200).send({ ok: true });
      }

      const { webhook_type, webhook_code, item_id, error } = parsed.data;

      const item = await db.query.PlaidItems.findFirst({
        where: { plaidItemId: item_id },
      });

      if (!item) return reply.status(200).send({ ok: true });

      if (webhook_type === "TRANSACTIONS" && SYNC_CODES.has(webhook_code)) {
        // Never sync inline — Plaid times out at 10s and retries.
        await enqueuePlaidSync(item.id);
      } else if (
        webhook_type === "ITEM" &&
        error?.error_code === "ITEM_LOGIN_REQUIRED"
      ) {
        await markLoginRequired(item);
      }

      return reply.status(200).send({ ok: true });
    },
  });
};
