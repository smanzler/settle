import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AuthCard } from "../components/auth-card";
import { parseAuthError, sendSignInOtp } from "../lib/auth-error";
import { OtpInput, type OtpInputRef } from "../components/otp-input";

const RESEND_COOLDOWN_SECONDS = 60;

const OTP_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Please try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Request a new code.",
};

export function VerifyOtp() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const { refetch: refetchSession } = authClient.useSession();

  const otpRef = useRef<OtpInputRef>(null);
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // `code` is passed explicitly by `onFilled`, which fires in the same tick as
  // the `onTextChange` that sets `otp` — the state read here would still be stale.
  const handleSubmit = async (code = otp) => {
    if (!email || submitting || code.length !== 6) return;

    setSubmitting(true);
    setError(null);
    try {
      const { error } = await authClient.signIn.emailOtp({ email, otp: code });

      if (error) throw error;

      // The session-signal update that better-auth fires internally after
      // sign-in is wrapped in a setTimeout, which is unreliable on Android
      // when the JS thread is otherwise idle. Refetch explicitly so the
      // session hook (and the Stack.Protected guard) updates immediately.
      await refetchSession();
    } catch (caught) {
      console.error(caught);
      const { code: errorCode } = parseAuthError(caught);
      setError(
        (errorCode && OTP_ERROR_MESSAGES[errorCode]) ??
          "Something went wrong. Please try again.",
      );
      setOtp("");
      otpRef.current?.clear();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!email || resendCooldown > 0) return;

    setResending(true);
    setError(null);
    try {
      await sendSignInOtp(email);

      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      console.error(error);
      setError("Couldn't send a new code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  if (!email) {
    return (
      <AuthCard
        title="Something went wrong"
        description="We couldn't find an email to verify."
      >
        <Button onPress={() => router.replace("/")}>
          <Text>Back to Sign In</Text>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Enter code"
      description={`We sent a 6-digit code to ${email}`}
    >
      <OtpInput
        ref={otpRef}
        onTextChange={(text) => {
          setOtp(text);
          setError(null);
        }}
        onFilled={handleSubmit}
        textInputProps={{
          returnKeyType: "go",
          onSubmitEditing: () => handleSubmit(),
        }}
      />

      {error && (
        <Text className="text-destructive text-center text-sm">{error}</Text>
      )}

      <Button
        onPress={() => handleSubmit()}
        disabled={submitting || otp.length !== 6}
      >
        {submitting && <Spinner className="text-secondary" />}
        <Text>Continue</Text>
      </Button>

      <View className="mx-auto flex-row">
        <Text className="text-muted-foreground text-sm">
          Didn&apos;t get a code?{" "}
        </Text>
        <Button
          variant="link"
          size="inline"
          onPress={handleResend}
          disabled={resending || resendCooldown > 0}
        >
          <Text className="underline">
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend"}
          </Text>
        </Button>
      </View>

      <View className="mx-auto flex-row">
        <Button
          variant="link"
          size="inline"
          onPress={() => router.replace("/")}
        >
          <Text className="underline">Use a different email</Text>
        </Button>
      </View>
    </AuthCard>
  );
}
