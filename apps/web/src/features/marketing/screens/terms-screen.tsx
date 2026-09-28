import {
  ContentPage,
  ContentSection,
} from "@/features/marketing/components/content-page";
import { SITE } from "@/lib/site";

// Placeholder outline: replace each section with your own terms before launch.
export function TermsScreen() {
  return (
    <ContentPage
      title="Terms of Service"
      description={`The terms that apply when you use ${SITE.name}.`}
      updatedAt={SITE.legal.updatedAt}
    >
      <ContentSection title="Using the service">
        <p>TODO: eligibility, accounts, and acceptable use.</p>
      </ContentSection>

      <ContentSection title="Your content">
        <p>TODO: ownership of what users upload, and the license you need.</p>
      </ContentSection>

      <ContentSection title="Termination">
        <p>TODO: when you or the user can end the account.</p>
      </ContentSection>

      <ContentSection title="Disclaimers and liability">
        <p>TODO: warranty disclaimer and limitation of liability.</p>
      </ContentSection>

      <ContentSection title="Governing law">
        <p>
          These terms are governed by the laws of {SITE.legal.governingLaw}.
        </p>
      </ContentSection>

      <ContentSection title="Contact">
        <p>
          Questions about these terms? Email{" "}
          <a href={`mailto:${SITE.email.support}`}>{SITE.email.support}</a>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
