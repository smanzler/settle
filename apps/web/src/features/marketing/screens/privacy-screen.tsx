import {
  ContentPage,
  ContentSection,
} from "@/features/marketing/components/content-page";
import { SITE } from "@/lib/site";

// Placeholder outline: replace each section with your own policy before launch.
export function PrivacyScreen() {
  return (
    <ContentPage
      title="Privacy Policy"
      description={`How ${SITE.name} collects, uses, and protects your information.`}
      updatedAt={SITE.legal.updatedAt}
    >
      <ContentSection title="Information we collect">
        <p>TODO: list the data the app and API collect, and why.</p>
      </ContentSection>

      <ContentSection title="How we use it">
        <p>TODO: describe how that data is used.</p>
      </ContentSection>

      <ContentSection title="Who we share it with">
        <p>
          TODO: list the service providers that process data (hosting, email,
          push notifications, file storage).
        </p>
      </ContentSection>

      <ContentSection title="Your choices">
        <p>
          You can ask us to delete your account and its data at any time by
          emailing{" "}
          <a href={`mailto:${SITE.email.privacy}`}>{SITE.email.privacy}</a>.
        </p>
      </ContentSection>

      <ContentSection title="Contact">
        <p>
          Questions about this policy? Email{" "}
          <a href={`mailto:${SITE.email.privacy}`}>{SITE.email.privacy}</a>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
