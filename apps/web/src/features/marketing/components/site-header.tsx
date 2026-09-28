import { Link } from "@tanstack/react-router";
import { SITE } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
        <Link
          to="/"
          className="font-heading text-lg font-semibold tracking-tight"
        >
          {SITE.name}
        </Link>
      </div>
    </header>
  );
}
