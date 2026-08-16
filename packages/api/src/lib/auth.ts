import db from "../db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import { expo } from "@better-auth/expo";
import { emailOTP } from "better-auth/plugins";
import * as schema from "../db/auth-schema";
import { ensureHousehold } from "./household";
import { sendEmail } from "./mailer";
import { renderOtpEmail } from "./otp-email";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema,
  }),
  plugins: [
    expo(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        const subject =
          type === "sign-in" ? "Your sign in code" : "Verify your email";

        const { html, text } = renderOtpEmail({
          otp,
          heading: subject,
          expiresInMinutes: 5,
        });

        await sendEmail({ to: email, subject, html, text });
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        /**
         * Give every new user a household immediately, so the very first
         * request already has a member seat to act as.
         *
         * Deliberately non-fatal: a failure here must not block sign-up, and
         * `householdProcedure` bootstraps lazily anyway. This hook exists so
         * the common path does not pay for it on first request.
         */
        after: async (user) => {
          try {
            await ensureHousehold(user);
          } catch (err) {
            console.error("failed to bootstrap household on signup:", err);
          }
        },
      },
    },
  },
  trustedOrigins: ["com.sigh10.budget://"],
  advanced: { database: { generateId: "uuid" } },
});

declare module "fastify" {
  interface FastifyRequest {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
  }
}

export const authHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  request.user = session.user;
  request.session = session.session;
};
