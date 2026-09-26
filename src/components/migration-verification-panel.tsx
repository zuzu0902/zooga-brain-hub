import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { coreApi } from "@/lib/hostinger-core/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

type Key = "contacts" | "messages" | "conversation_turns";
const ROWS: { key: Key; label: string; aliases: string[] }[] = [
  { key: "contacts", label: "אנשי קשר", aliases: ["contacts", "contacts_total", "contact_count", "total_contacts"] },
  { key: "messages", label: "הודעות", aliases: ["messages", "messages_total", "message_count", "total_messages"] },
  { key: "conversation_turns", label: "תורות שיחה", aliases: ["conversation_turns", "turns", "conversation_turns_total", "turn_count"] },
];

/** Read-only exact count; archived contacts excluded to match the canonical CRM list. */
async function countLocal(key: Key): Promise<number | null> {
  let q = supabase.from(key).select("id", { count: "exact", head: true });
  if (key === "contacts") q = q.is("archived_at", null);
  const { count, error } = await q;
  return error ? null : count ?? 0;
}

function pickCount(body: any, aliases: string[]): number | null {
  const scopes = [body, body?.overview, body?.counts, body?.data, body?.data?.counts, body?.totals];
  for (const s of scopes) {
    if (!s || typeof s !== "object") continue;
    for (const a of aliases) {
      const v = s[a];
      if (typeof v === "number") return v;
      if (v && typeof v === "object" && typeof v.total === "number") return v.total;
      if (v && typeof v === "object" && typeof v.count === "number") return v.count;
    }
  }
  return null;
}

async function runCheck() {
  const [contacts, messages, turns] = await Promise.all(ROWS.map((r) => countLocal(r.key)));
  const local: Record<Key, number | null> = { contacts, messages, conversation_turns: turns };
  let core: Record<Key, number | null> | null = null;
  let coreError: string | null = null;
  try {
    const body = await coreApi.overview();
    core = Object.fromEntries(ROWS.map((r) => [r.key, pickCount(body, r.aliases)])) as Record<Key, number | null>;
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : null;
    coreError = status === 401 || status === 403
      ? "השרת החיצוני דחה את ההרשאה"
      : status
        ? `השרת החיצוני אינו זמין (קוד ${status})`
        : "השרת החיצוני אינו נגיש כרגע";
  }
  return { local, core, coreError, checkedAt: new Date() };
}

export function MigrationVerificationPanel() {
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_admin");
      return !error && data === true;
    },
  });
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["migration-verification"],
    queryFn: runCheck,
    enabled: isAdmin === true,
    refetchOnWindowFocus: false,
  });

  if (isAdmin !== true) return null;

  const allMatch = data?.core && ROWS.every((r) => data.local[r.key] !== null && data.local[r.key] === data.core![r.key]);
  const status = !data
    ? { icon: RefreshCw, text: "בודק...", cls: "text-muted-foreground" }
    : data.coreError
      ? { icon: XCircle, text: "השרת החיצוני לא זמין", cls: "text-destructive" }
      : allMatch
        ? { icon: CheckCircle2, text: "המספרים תואמים", cls: "text-success" }
        : { icon: AlertTriangle, text: "נמצאו פערים", cls: "text-warning-foreground" };
  const StatusIcon = status.icon;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h3 className="font-semibold">אימות העברת נתונים</h3>
          <p className="text-xs text-muted-foreground">השוואת קריאה בלבד — מסד הנתונים הנוכחי מול Hostinger Core</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-sm font-medium ${status.cls}`}>
            <StatusIcon className="h-4 w-4" /> {status.text}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> בדוק שוב
          </Button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-muted-foreground border-b">
            <th className="py-2 font-medium">סוג</th>
            <th className="py-2 font-medium">מסד נתונים נוכחי</th>
            <th className="py-2 font-medium">Hostinger Core</th>
            <th className="py-2 font-medium">הפרש</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const l = data?.local[r.key] ?? null;
            const c = data?.core?.[r.key] ?? null;
            const diff = l !== null && c !== null ? c - l : null;
            return (
              <tr key={r.key} className="border-b last:border-b-0">
                <td className="py-2">{r.label}</td>
                <td className="py-2 tabular-nums">{l === null ? "—" : l.toLocaleString("he-IL")}</td>
                <td className="py-2 tabular-nums">{c === null ? "—" : c.toLocaleString("he-IL")}</td>
                <td className={`py-2 tabular-nums ${diff ? "text-destructive" : diff === 0 ? "text-success" : "text-muted-foreground"}`}>
                  {diff === null ? "—" : diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex justify-between flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{data?.coreError ?? (data?.core ? "" : "")}</span>
        <span>{data ? `נבדק לאחרונה: ${data.checkedAt.toLocaleString("he-IL")}` : ""}</span>
      </div>
    </Card>
  );
}
