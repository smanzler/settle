import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionItem,
  SectionItemContent,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { AccountSplitSheet } from "@/features/household/components/account-split-sheet";
import { HouseholdSwitcher } from "@/features/household/components/household-switcher";
import { InviteSheet } from "@/features/household/components/invite-sheet";
import { MemberList } from "@/features/household/components/member-list";
import { useHousehold } from "@/features/household/hooks/use-household";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "expo-router";
import { KeyRound, UsersRound } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { AccountsEmpty } from "../components/accounts-empty";
import { ConnectBankButton } from "../components/connect-bank-button";
import { DisconnectItemDialog } from "../components/disconnect-item-dialog";
import { InstitutionSection } from "../components/institution-section";
import { usePlaidItems } from "../hooks/use-plaid-items";
import { useSyncNow } from "../hooks/use-sync-now";
import {
  formatLastSynced,
  type BankAccount,
  type PlaidItem,
} from "../lib/format";

export function Accounts() {
  const items = usePlaidItems();
  const syncNow = useSyncNow();
  const household = useHousehold();
  const router = useRouter();

  const [pendingDisconnect, setPendingDisconnect] = useState<PlaidItem | null>(
    null,
  );
  const [pendingAccount, setPendingAccount] = useState<BankAccount | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = useState(false);

  const lastSyncedAt = items.data
    ?.map((item) => item.lastSyncedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  if (items.isError) {
    return (
      <RefetchScroll
        refetch={items.refetch}
        isEmpty
        empty={
          <LoadError
            title="Couldn't load your accounts"
            onRetry={() => void items.refetch()}
          />
        }
      />
    );
  }

  return (
    <>
      {/* Above the scroll, and on this screen rather than Household, for two
          reasons that both come down to reachability: `isEmpty` swaps the
          children out — and somebody who has just joined a household has no bank
          connections yet — while the Household screen is gated behind
          `isShared`, so switching into a household you are alone in would take
          the switcher away with it and leave no way back. Accounts is reachable
          from the Transactions header unconditionally. */}
      <HouseholdSwitcher className="px-4 pt-3" />

      <RefetchScroll
        refetch={items.refetch}
        isLoading={items.isPending}
        loading={<LoadingBlock />}
        isEmpty={items.data?.length === 0}
        empty={<AccountsEmpty />}
      >
        {household.isShared ? (
          <Section>
            <SectionHeader>
              <SectionTitle>Household</SectionTitle>
            </SectionHeader>

            <MemberList
              onMemberPress={() => router.push("/household")}
              onInvite={() => setInviteOpen(true)}
            />
          </Section>
        ) : (
          // The whole feature, behind one verb. Nothing about splitting exists
          // on this screen until there is somebody to split with, so this row
          // has to read as an offer rather than as a setting.
          <Section>
            <SectionContent>
              <SectionItem onPress={() => setInviteOpen(true)} size="tall">
                <Icon as={UsersRound} className="text-foreground size-4" />
                <Text className="font-medium">Split with someone</Text>
                <SectionItemContent />
              </SectionItem>
              {/* The other side of the same door. An invite normally arrives by
                  email or shows up on Transactions by itself, so this is only
                  for a code read off somebody else's screen — which is exactly
                  the case that has nowhere else to go. */}
              <SectionItem onPress={() => router.push("/join")} size="tall">
                <Icon as={KeyRound} className="text-foreground size-4" />
                <Text className="font-medium">I have an invite code</Text>
                <SectionItemContent />
              </SectionItem>
            </SectionContent>
          </Section>
        )}

        {items.data?.map((item) => (
          <InstitutionSection
            key={item.id}
            item={item}
            members={household.members}
            onDisconnect={setPendingDisconnect}
            onEditAccount={setPendingAccount}
          />
        ))}

        <View className="gap-2 pt-2">
          <ConnectBankButton
            label="Connect another account"
            variant="outline"
          />

          <Button
            variant="ghost"
            disabled={syncNow.isPending}
            onPress={() => void syncNow.mutateAsync({}).catch(console.error)}
          >
            {syncNow.isPending ? (
              <Spinner className="text-muted-foreground" />
            ) : null}
            <Text>Sync now</Text>
          </Button>

          <Text className="text-muted-foreground text-center text-xs">
            {formatLastSynced(lastSyncedAt ?? null)}
          </Text>
        </View>

        <View className="pt-6">
          <Button variant="outline" onPress={() => void authClient.signOut()}>
            <Text>Sign out</Text>
          </Button>
        </View>
      </RefetchScroll>

      {/* Rendered outside RefetchScroll: on iOS DialogOverlay wraps itself in a
          FullWindowOverlay, and anything Plaid presents over it is unreachable.
          Nothing here opens Link, but keep them separate. */}
      <DisconnectItemDialog
        itemId={pendingDisconnect?.id ?? null}
        institutionName={pendingDisconnect?.institutionName ?? null}
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
      />

      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />

      {/* Keyed on the account: every field in the sheet seeds from this prop,
          and the remount is what reseeds them when another row is opened. */}
      <AccountSplitSheet
        key={pendingAccount?.id}
        account={pendingAccount}
        open={pendingAccount !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAccount(null);
        }}
      />
    </>
  );
}
