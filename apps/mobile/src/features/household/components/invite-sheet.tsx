import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { inviteInputSchema } from "@budget/shared";
import { Share2 } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { shareInvite, useInvite } from "../hooks/use-invite";
import { formatApiError } from "@/lib/errors";

const INVALID_EMAIL = "That doesn't look like an email address.";

/** `Aug 20` — the invite's own expiry, never a hard-coded window. */
const formatExpiry = (expiresAt: string) =>
  new Date(expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/**
 * Creates the seat, then shows the code.
 *
 * Nothing is emailed: the code is created here and travels by whatever the
 * share sheet offers, which is why the address it is bound to has to be on
 * screen next to it.
 */
export function InviteSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invite = useInvite();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  const created = invite.data;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      invite.reset();
      setEmail("");
      setEmailError(null);
      setDisplayName("");
    }

    onOpenChange(next);
  };

  const handleEmailChange = (next: string) => {
    setEmail(next);
    setEmailError(null);
  };

  const handleInvite = async () => {
    const parsed = inviteInputSchema.shape.email.safeParse(email.trim());

    if (!parsed.success) {
      setEmailError(INVALID_EMAIL);
      return;
    }

    try {
      await invite.mutateAsync({
        email: parsed.data,
        displayName: displayName.trim(),
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Send {displayName.trim()} their code</DialogTitle>
              <DialogDescription>
                It only works when {email.trim()} signs in — forwarding it
                won&apos;t let anyone else into your household.
              </DialogDescription>
            </DialogHeader>

            <View className="bg-muted items-center gap-1 rounded-lg py-4">
              <Text
                selectable
                className="text-2xl font-semibold tracking-[3px]"
              >
                {created.code}
              </Text>
              <Text className="text-muted-foreground text-xs">
                Expires {formatExpiry(created.expiresAt)}
              </Text>
            </View>

            <DialogFooter>
              <Button variant="outline" onPress={() => handleOpenChange(false)}>
                <Text>Done</Text>
              </Button>
              <Button
                onPress={() =>
                  void shareInvite({
                    code: created.code,
                    email: email.trim(),
                  }).catch(console.error)
                }
              >
                <Icon as={Share2} className="text-primary-foreground size-4" />
                <Text>Share</Text>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite someone</DialogTitle>
              <DialogDescription>
                You can start splitting with them straight away — they
                don&apos;t have to accept first.
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="gap-4">
              <Field className="gap-1">
                <FieldLabel>Their name</FieldLabel>
                <Input
                  autoCapitalize="words"
                  autoComplete="name"
                  value={displayName}
                  onChangeText={setDisplayName}
                />
              </Field>

              <Field className="gap-1">
                <FieldLabel>Their email</FieldLabel>
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  aria-invalid={emailError !== null}
                  value={email}
                  onChangeText={handleEmailChange}
                />
                <FieldError>{emailError}</FieldError>
              </Field>
            </FieldGroup>

            {invite.isError ? (
              <Text className="text-destructive text-sm">
                {/* Zod rejects the address with a stack of field errors, which
                    is the one refusal here not worth quoting. */}
                {invite.error.data?.code === "BAD_REQUEST"
                  ? INVALID_EMAIL
                  : formatApiError(
                      invite.error,
                      "Couldn't create the invite. Please try again.",
                    )}
              </Text>
            ) : null}

            <DialogActions
              confirmLabel="Create invite"
              disabled={email.trim() === "" || displayName.trim() === ""}
              isPending={invite.isPending}
              onCancel={() => handleOpenChange(false)}
              onConfirm={() => void handleInvite()}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
