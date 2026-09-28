import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ContentPage } from "@/features/marketing/components/content-page";
import { SITE } from "@/lib/site";

export function NotFoundScreen() {
  return (
    <ContentPage
      title="Page not found"
      description="The page you asked for does not exist, or it has moved."
    >
      <p>
        Head back to the <Link to="/">{SITE.name} home page</Link>, or{" "}
        <Link to="/support">let us know</Link> if you followed a link that
        should have worked.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button render={<Link to="/" />} size="lg">
          Back to home
        </Button>
        <Button render={<Link to="/support" />} variant="outline" size="lg">
          Get support
        </Button>
      </div>
    </ContentPage>
  );
}
