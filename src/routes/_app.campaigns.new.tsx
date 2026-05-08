import { createFileRoute, Link } from "@tanstack/react-router";
import { CampaignForm } from "@/components/campaign-form";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_app/campaigns/new")({
  head: () => ({ meta: [{ title: "קמפיין חדש — Zooga CRM" }] }),
  component: NewCampaignPage,
});

function NewCampaignPage() {
  return (
    <div className="p-6 space-y-4" dir="rtl">
      <nav className="text-sm text-muted-foreground flex items-center gap-1">
        <Link to="/campaigns" className="hover:text-foreground">קמפיינים</Link>
        <ChevronRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground">חדש</span>
      </nav>
      <h1 className="text-3xl font-bold tracking-tight">קמפיין חדש</h1>
      <CampaignForm />
    </div>
  );
}