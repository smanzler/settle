import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";

// Fixed timezone: the date renders on the server and must match on rehydration.
const updatedAtFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

const formatUpdatedAt = (date: string) =>
  updatedAtFormat.format(new Date(`${date}T00:00:00Z`));

export function ContentPage({
  title,
  description,
  updatedAt,
  children,
}: {
  title: string;
  description: string;
  /** ISO date (`YYYY-MM-DD`). Renders a "last updated" stamp when given. */
  updatedAt?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 pt-32 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-balance text-muted-foreground">{description}</p>
        {updatedAt && (
          <p className="mt-6 text-xs tracking-wide text-muted-foreground uppercase">
            Last updated{" "}
            <time dateTime={updatedAt}>{formatUpdatedAt(updatedAt)}</time>
          </p>
        )}
        <Separator className="my-10" />
        <div className="space-y-10 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h3]:mt-6 [&_h3]:font-heading [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-foreground [&_li]:pl-1 [&_p]:mt-3 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function ContentSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-heading text-xl font-medium text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
