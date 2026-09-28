import { requestPushPermission } from "@/features/notifications/lib/permissions";
import { Bell } from "lucide-react-native";
import { OnboardingStep } from "../components/onboarding-step";
import { useOnboardingStore } from "../stores/onboarding-store";

export default function NotificationsStep() {
  const complete = useOnboardingStore((state) => state.complete);

  return (
    <OnboardingStep
      step={0}
      icon={Bell}
      title="Stay in the loop"
      description="Turn on notifications so you hear about activity on your account as it happens."
      request={requestPushPermission}
      next={complete}
    />
  );
}
