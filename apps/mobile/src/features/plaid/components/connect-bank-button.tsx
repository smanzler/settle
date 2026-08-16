import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatAccountLabel } from "@/features/transactions/lib/format";
import { TriangleAlert } from "lucide-react-native";
import { Pressable } from "@/components/ui/pressable";
import { View } from "react-native";
import { usePlaidLink } from "../hooks/use-plaid-link";

/**
 * Opens Plaid Link. Plaid presents its own full-screen native UI, which is why
 * there is no connect *route* anywhere in the app.
 */
export function ConnectBankButton({
  label = "Connect a bank",
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  const link = usePlaidLink();

  // The default button is dark, the others are light — a fixed spinner color
  // would be invisible on one of them.
  const spinnerClass =
    variant === "default" ? "text-primary-foreground" : "text-foreground";

  return (
    <View className="w-full gap-2">
      <Button
        variant={variant}
        disabled={link.isPending}
        onPress={() => void link.open()}
      >
        {link.isPending ? <Spinner className={spinnerClass} /> : null}
        <Text>{label}</Text>
      </Button>

      {link.error ? (
        <Text className="text-destructive text-center text-sm">
          {link.error}
        </Text>
      ) : null}

      {/* A warning, not a refusal: the connection succeeded. Two members
          linking the same joint account is the ordinary way a household ends
          up counting it twice, and nothing else in the app would say so. */}
      {link.duplicate ? (
        <View className="border-border bg-muted/40 flex-row gap-2 rounded-md border p-3">
          <Icon
            as={TriangleAlert}
            className="text-muted-foreground mt-0.5 size-4"
          />

          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-sm">
              {link.duplicate.institutionName ?? "That bank"}{" "}
              {formatAccountLabel({
                name: link.duplicate.name,
                mask: link.duplicate.mask,
              })}{" "}
              is already connected
              {link.duplicate.inAnotherHousehold
                ? // The serious one: the same charge can now be split — and
                  // collected — in both places, and no invariant in the app can
                  // see it, because every check is scoped to one household.
                  ` in ${link.duplicate.householdName}. Anything you split here will be owed to you a second time there, so only keep one of them.`
                : " here, so its transactions may now show up twice."}
            </Text>

            <Pressable hitSlop={8} onPress={link.dismissDuplicate}>
              <Text className="text-muted-foreground text-xs font-medium">
                Got it
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
