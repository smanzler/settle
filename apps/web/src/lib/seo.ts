import { SITE } from "@/lib/site";

/** Page-level `head` for a route. Pass the full `<title>`, not just the page name. */
export const buildPageHead = ({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) => {
  const url = `${SITE.url}${path}`;

  return {
    links: [{ rel: "canonical", href: url }],
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
  };
};
