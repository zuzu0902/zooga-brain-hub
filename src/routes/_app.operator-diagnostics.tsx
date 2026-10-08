import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { useControlCenter } from "@/lib/hostinger-core/use-control-center";
import { CoreReadState } from "@/components/operator-data";
export const Route = createFileRoute("/_app/operator-diagnostics")({ head: () => operatorHead("אימות Core", "נתוני מוכנות ואימות חיבור לקריאה בלבד."), component: Diagnostics });
function Diagnostics() {
  const q = useControlCenter();
  return <div className="p-4 md:p-6 space-y-5" dir="rtl"><h1 className="text-2xl font-bold">אימות Core</h1><CoreReadState loading={q.waitingForAuth || q.isPending} error={q.error} retry={() => q.refetch()} />{q.data && !q.error && <><dl className="grid grid-cols-2 gap-3 max-w-xl"><dt>חיבור</dt><dd>תקין</dd><dt>אנשים</dt><dd>{q.data.control_center.summary.contacts}</dd><dt>שיחות פעילות</dt><dd>{q.data.control_center.summary.active_conversations}</dd><dt>משימות פתוחות</dt><dd>{q.data.control_center.summary.open_tasks}</dd><dt>מצב עבודה</dt><dd dir="ltr">{q.data.readiness?.mode ?? "לא זמין"}</dd></dl><p className="text-sm text-muted-foreground">אימות המעבר ההיסטורי והאבחון הישן אינם מוצגים במרכז השליטה.</p></>}</div>;
}