import db from "../db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { emailOTP } from "better-auth/plugins";
import * as schema from "../db/auth-schema";
import { ensureGroup } from "./group";
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
         * Give every new user a group immediately, so the very first request
         * already has a member seat to act as.
         *
         * Deliberately non-fatal: a failure here must not block sign-up, and
         * `groupProcedure` bootstraps lazily anyway. This hook exists so the
         * common path does not pay for it on first request.
         */
        after: async (user) => {
          try {
            await ensureGroup(user);
          } catch (err) {
            console.error("failed to bootstrap a group on signup:", err);
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
