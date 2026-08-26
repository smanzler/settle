import { MemberAvatar } from "@/components/member-avatar";
import { SectionContent, SectionItem } from "@/components/section";
import { Text } from "@/components/ui/text";
import { formatCents } from "@/lib/money";
import type { RouterOutputs } from "@/lib/trpc";

/** What one member put in, or what one member owes. */
export type Slice = RouterOutputs["expenses"]["get"]["payers"][number];

/**
 * Names against amounts, as a card.
 *
 * Who paid and who owes are the same shape, so an expense shows this component
 * twice — which is also what makes the two lists read as one pair rather than
 * as two unrelated tables.
 */
export function SliceList({
  slices,
  currency,
}: {
  slices: readonly Slice[];
  currency?: string | null;
}) {
  return (
    <SectionContent>
      {slices.map((slice) => {
        const name = slice.isYou ? "You" : slice.displayName;

        return (
          <SectionItem key={slice.id}>
            {/* The initials stay the member's; `alt` follows what the row says. */}
            <MemberAvatar displayName={slice.displayName} alt={name} />

            <Text numberOfLines={1} className="min-w-0 flex-1 font-medium">
              {name}
            </Text>

            <Text className="tabular-nums">
              {formatCents(slice.amountCents, currency)}
            </Text>
          </SectionItem>
        );
      })}
    </SectionContent>
  );
}
