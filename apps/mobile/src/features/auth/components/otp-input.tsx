import { THEME } from "@/lib/theme";
import { forwardRef } from "react";
import {
  OtpInput as OtpEntryInput,
  type OtpInputProps as OtpEntryInputProps,
  type OtpInputRef,
} from "react-native-otp-entry";
import { useUniwind } from "uniwind";

export type { OtpInputRef };

export const OtpInput = forwardRef<
  OtpInputRef,
  Omit<OtpEntryInputProps, "theme">
>(function OtpInput({ numberOfDigits = 6, ...props }, ref) {
  const { theme } = useUniwind();
  const colors = THEME[theme];

  return (
    <OtpEntryInput
      ref={ref}
      numberOfDigits={numberOfDigits}
      focusColor={colors.ring}
      theme={{
        containerStyle: { gap: 8 },
        pinCodeContainerStyle: {
          flex: 1,
          height: 56,
          borderRadius: 8,
          borderColor: colors.input,
          backgroundColor: colors.background,
        },
        focusedPinCodeContainerStyle: {
          borderColor: colors.ring,
        },
        pinCodeTextStyle: {
          fontSize: 20,
          fontWeight: "500",
          color: colors.foreground,
        },
      }}
      {...props}
    />
  );
});
