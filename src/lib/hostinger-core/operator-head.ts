export function operatorHead(title: string, description: string) {
  return { meta: [
    { title: `${title} — Zooga OS` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Zooga OS` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] };
}