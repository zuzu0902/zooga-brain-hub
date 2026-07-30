import { createFileRoute, Link } from "@tanstack/react-router";
import { CampaignForm } from "@/components/campaign-form";
import { ChevronRight } from "lucide-react";
import { useT, useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/campaigns/new")({
  head: () => ({ meta: [{ title: "קמפיין חדש — Zooga CRM" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    offer_id: typeof search.offer_id === "string" ? search.offer_id : undefined,
  }),
  component: NewCampaignPage,
});

function NewCampaignPage() {
  const t = useT();
  const { dir } = useLanguage();
  const { offer_id } = Route.useSearch();
  return (
    <div className="p-6 space-y-4" dir={dir}>
      <nav className="text-sm text-muted-foreground flex items-center gap-1">
        <Link to="/campaigns" className="hover:text-foreground">{t("קמפיינים")}</Link>
        <ChevronRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground">{t("חדש")}</span>
      </nav>
      <h1 className="text-3xl font-bold tracking-tight">{t("קמפיין חדש")}</h1>
      <CampaignForm initial={offer_id ? { offer_id } : undefined} />
    </div>
  );
}
