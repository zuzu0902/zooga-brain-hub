import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { operatorHead } from "@/lib/hostinger-core/operator-head";

/** Legacy URL kept. Individual template sending lives only in the Core Campaign Manager — no sender is mounted here. */
export const Route = createFileRoute("/_app/intake-campaign")({
  head: () => operatorHead("קמפיין אינטייק", "שליחה אישית בתבניות מאושרות עברה למנהל הקמפיינים."),
  component: IntakeCampaignPage,
});

function IntakeCampaignPage() {
  return <div className="p-6 max-w-3xl mx-auto" dir="rtl">
    <Card className="p-6 space-y-3">
      <h1 className="text-2xl font-bold">קמפיין אינטייק</h1>
      <p className="text-sm text-muted-foreground">שליחה אישית בתבנית WhatsApp מאושרת מתבצעת עכשיו רק דרך מנהל הקמפיינים (Core), כדי שיהיה מנוע שליחה אחד.</p>
      <Link to="/campaign-manager" className="text-primary font-medium">מעבר למנהל הקמפיינים</Link>
    </Card>
  </div>;
}
