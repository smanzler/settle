import { ApiError } from "@/components/api-error";
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionTitle,
} from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Check, House } from "lucide-react-native";
import { View } from "react-native";
import {
  useHouseholdList,
  useSetActiveHousehold,
} from "../hooks/use-household";

/**
 * Picks which household the app is looking at.
 *
 * Renders nothing for the one-household case, which is almost everybody: a
 * switcher with a single row is a setting that looks like a choice.
 *
 * Switching is a server write, not client state — scope is resolved from the
 * session so that no procedure ever takes a household id as input — which is why
 * the rows disable while it is in flight rather than moving the highlight
 * optimistically.
 */
export function HouseholdSwitcher({ className }: { className?: string }) {
  const { households, canSwitch } = useHouseholdList();
  const setActive = useSetActiveHousehold();

  // Nothing at all, not an empty padded box: callers place this above a scroll
  // view, where a wrapper would leave dead space on every one-household screen.
  if (!canSwitch) return null;

  return (
    <Section className={className}>
      <SectionHeader>
        <SectionTitle>Households</SectionTitle>
        <SectionDescription>
          Transactions, balances and accounts all belong to whichever one is
          selected.
        </SectionDescription>
      </SectionHeader>

      <SectionContent>
        {households.map((household) => (
          <SectionItem
            key={household.householdId}
            size="tall"
            onPress={
              household.isActive || setActive.isPending
                ? undefined
                : () => setActive.mutate({ householdId: household.householdId })
            }
          >
            <Icon as={House} className="text-foreground size-4" />

            <View className="min-w-0 flex-1 gap-0.5">
              <Text numberOfLines={1} className="font-medium">
                {household.name}
              </Text>
              {household.role === "owner" ? (
                <Text className="text-muted-foreground text-xs">
                  You own this one
                </Text>
              ) : null}
            </View>

            {household.isActive ? (
              <Badge variant="secondary" size="sm">
                <Text>Current</Text>
              </Badge>
            ) : setActive.isPending &&
              setActive.variables?.householdId === household.householdId ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              <Icon as={Check} className="text-muted-foreground/0 size-4" />
            )}
          </SectionItem>
        ))}
      </SectionContent>

      <ApiError error={setActive.error} fallback="Couldn't switch household." />
    </Section>
  );
}
