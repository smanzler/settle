import { authClient } from "@/lib/auth-client";
import { z } from "zod";

/**
 * The two fields better-auth puts on a thrown error that the sign-in screens act
 * on. Both are optional: a dropped connection throws without either one.
 */
export const authErrorSchema = z.object({
  code: z.string().optional(),
  status: z.number().optional(),
});

export type AuthError = z.infer<typeof authErrorSchema>;

/** What the screens read off a caught value, or an empty object. */
export const parseAuthError = (caught: unknown): AuthError =>
  authErrorSchema.safeParse(caught).data ?? {};

/** Mails the sign-in code. Throws what better-auth returns, for the caller. */
export const sendSignInOtp = async (email: string) => {
  const { error } = await authClient.emailOtp.sendVerificationOtp({
    email,
    type: "sign-in",
  });

  if (error) throw error;
};
