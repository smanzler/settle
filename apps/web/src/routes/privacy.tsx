import { createFileRoute } from "@tanstack/react-router";
import { PrivacyScreen } from "@/features/marketing/screens/privacy-screen";
import { buildPageHead } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  component: PrivacyScreen,
  head: () =>
    buildPageHead({
      title: `Privacy Policy — ${SITE.name}`,
      description: `How ${SITE.name} collects, uses, and protects your information.`,
      path: "/privacy",
    }),
});
