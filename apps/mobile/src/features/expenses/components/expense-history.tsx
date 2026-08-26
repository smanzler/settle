import { ApiError } from "@/components/api-error";
import {
  Section,
  SectionContent,
  SectionItem,
  SectionTitle,
} from "@/components/section";
import { Icon } from "@/components/ui/icon";
import { Pressable } from "@/components/ui/pressable";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatIsoDate, todayIsoDate } from "@/lib/date";
import { formatCents } from "@/lib/money";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useExpenseHistory } from "../hooks/use-expense";

/**
 * A timestamp as the day it happened, in the device's timezone.
 *
 * `formatIsoDate` takes a calendar day, so the timestamp goes through
 * `todayIsoDate`, which is the local-day conversion. Do not slice the ISO
 * string instead: that gives the UTC day, which is the wrong day for part of
 * every day.
 */
const formatDay = (value: string | null): string | null => {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : formatIsoDate(todayIsoDate(date));
};

/**
 * Every revision of one expense, oldest first — behind a collapsed header.
 *
 * Render it only for an expense that has been revised: one version says nothing
 * the screen above it does not already show. The versions are fetched when the
 * section opens, so an expense nobody asks about costs no query at all.
 */
export function ExpenseHistory({
  expenseId,
  currency,
}: {
  expenseId: string;
  currency?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const query = useExpenseHistory(expenseId, { enabled: isOpen });

  const renderBody = () => {
    if (query.isPending) {
      return <Spinner className="text-muted-foreground self-center" />;
    }

    if (query.isError) {
      return (
        <ApiError
          error={query.error}
          fallback="Couldn't load the edit history."
        />
      );
    }

    return (
      <SectionContent>
        {/* The server orders these oldest first, which is the order an audit
            trail is read in. */}
        {query.data.map((version) => {
          const day = formatDay(version.createdAt);
          const who = version.createdBy.isYou
            ? "you"
            : version.createdBy.displayName;

          return (
            <SectionItem key={version.version} size="tall">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={1} className="font-medium">
                  v{version.version} ·{" "}
                  {version.version === 1 ? "Added" : "Edited"} by {who}
                </Text>

                {day ? (
                  <Text className="text-muted-foreground text-xs">{day}</Text>
                ) : null}

                {version.note ? (
                  <Text
                    numberOfLines={2}
                    className="text-muted-foreground text-xs"
                  >
                    {version.note}
                  </Text>
                ) : null}
              </View>

              <Text className="tabular-nums">
                {formatCents(version.amountCents, currency)}
              </Text>
            </SectionItem>
          );
        })}
      </SectionContent>
    );
  };

  return (
    <Section>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center gap-1 active:opacity-70"
        onPress={() => setIsOpen(!isOpen)}
      >
        <SectionTitle>Edit history</SectionTitle>
        <Icon
          as={isOpen ? ChevronDown : ChevronRight}
          className="text-muted-foreground size-4"
        />
      </Pressable>

      {isOpen ? renderBody() : null}
    </Section>
  );
}
