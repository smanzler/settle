import { createFileRoute } from "@tanstack/react-router";
import { SupportScreen } from "@/features/marketing/screens/support-screen";
import { buildPageHead } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/support")({
  component: SupportScreen,
  head: () =>
    buildPageHead({
      title: `Support — ${SITE.name}`,
      description: `Get help with ${SITE.name}, report a bug, or ask a question.`,
      path: "/support",
    }),
});
