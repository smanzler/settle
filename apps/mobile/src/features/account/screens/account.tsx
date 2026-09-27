import {
  Section,
  SectionContent,
  SectionItem,
  SectionItemContent,
  SectionItemTitle,
} from "@/components/section";
import { BodyScrollView } from "@/components/ui/body-scroll-view";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding-store";
import { authClient } from "@/lib/auth-client";
import { AvatarPicker } from "../components/avatar-picker";
import { EditNameDialog } from "../components/edit-name-dialog";

export function Account() {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const resetOnboarding = useOnboardingStore((state) => state.reset);

  return (
    <BodyScrollView>
      <AvatarPicker name={user?.name ?? ""} image={user?.image} />

      <Section>
        <SectionContent>
          <EditNameDialog currentName={user?.name ?? ""}>
            <SectionItem>
              <SectionItemTitle>Name</SectionItemTitle>
              <SectionItemContent>{user?.name}</SectionItemContent>
            </SectionItem>
          </EditNameDialog>
          <SectionItem>
            <SectionItemTitle>Signed in as</SectionItemTitle>
            <SectionItemContent>
              <Text className="text-muted-foreground text-sm">
                {user?.email}
              </Text>
            </SectionItemContent>
          </SectionItem>
        </SectionContent>
      </Section>

      <Button variant="outline" onPress={() => authClient.signOut()}>
        <Text>Sign out</Text>
      </Button>
      {__DEV__ && (
        <Button variant="ghost" onPress={resetOnboarding}>
          <Text>Reset onboarding</Text>
        </Button>
      )}
    </BodyScrollView>
  );
}
