import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  ContentPage,
  ContentSection,
} from "@/features/marketing/components/content-page";
import { SITE } from "@/lib/site";

export function SupportScreen() {
  return (
    <ContentPage
      title="Support"
      description={`Something broken, confusing, or missing in ${SITE.name}? Tell us and we will look at it.`}
    >
      <ContentSection title="Get in touch">
        <p>
          Email{" "}
          <a href={`mailto:${SITE.email.support}`}>{SITE.email.support}</a> and
          we will get back to you.
        </p>
        <div className="mt-5">
          <Button
            render={<a href={`mailto:${SITE.email.support}`} />}
            size="lg"
          >
            Email support
          </Button>
        </div>
      </ContentSection>

      <ContentSection title="Reporting a bug">
        <p>The more of this you can include, the faster we can fix it:</p>
        <ul>
          <li>What you expected to happen, and what happened instead.</li>
          <li>The steps that led to it, and whether it happens every time.</li>
          <li>Your device and OS version, and the {SITE.name} app version.</li>
          <li>A screenshot or screen recording, if you have one.</li>
        </ul>
      </ContentSection>

      <ContentSection title="Your account and data">
        <p>
          To delete your account, email{" "}
          <a href={`mailto:${SITE.email.support}`}>{SITE.email.support}</a> from
          the address on your account. For how we handle your data, read our{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </ContentSection>
    </ContentPage>
  );
}
