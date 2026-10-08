import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { coreApi, listAll } from "@/lib/hostinger-core/client";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CoreReadState, Empty } from "@/components/operator-data";
import { operatorLabel } from "@/lib/hostinger-core/control-center";
export const Route = createFileRoute("/_app/catalog")({ head: () => operatorHead("קטלוג ומכירות", "פריטי הקטלוג ומנהל קמפיינים בזוגה."), component: Catalog });
function Catalog() {
  const { session, loading } = useAuth();
  const q = useQuery({ queryKey: ["operator-core-catalog", session?.user.id], enabled: !loading && !!session, queryFn: () => listAll(p => coreApi.listCatalog(p), 5000), retry: 1 });
  return <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" dir="rtl"><header className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">קטלוג ומכירות</h1><Button asChild variant="outline"><Link to="/campaign-manager">מנהל קמפיינים</Link></Button></header><CoreReadState loading={loading || !session || q.isPending} error={q.error} retry={() => q.refetch()} />{q.data && !q.error && <>{!q.data.length ? <Empty text="אין פריטים בקטלוג" /> : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{q.data.map(item => <Card key={item.id} className="rounded-md p-5 space-y-3"><h2 className="font-semibold break-words">{item.title || "ללא שם"}</h2><Badge variant="outline">{operatorLabel(item.status)}</Badge>{item.location && <p className="text-sm text-muted-foreground">{item.location}</p>}{typeof item.price === "number" && <p className="font-medium">{new Intl.NumberFormat("he-IL", { style: "currency", currency: /^[A-Z]{3}$/.test(item.currency ?? "") ? item.currency : "ILS" }).format(item.price)}</p>}</Card>)}</div>}<p className="text-sm text-muted-foreground border-t pt-4">עריכת הקטלוג אינה זמינה כאן כרגע.</p></>}</div>;
}