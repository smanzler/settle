import { createFileRoute } from "@tanstack/react-router";
import { TermsScreen } from "@/features/marketing/screens/terms-screen";
import { buildPageHead } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  component: TermsScreen,
  head: () =>
    buildPageHead({
      title: `Terms of Service — ${SITE.name}`,
      description: `The terms that apply when you use ${SITE.name}.`,
      path: "/terms",
    }),
});
