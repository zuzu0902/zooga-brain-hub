/**
 * ZOOGA OS — SYSTEM READINESS (advanced, read-only).
 * Status projection only: no command, no send, no CRM mutation, no secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { emptyStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";
import {
  BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE,
  CANONICAL_RUNTIME_LABEL_HE,
  computeReadinessBlockers,
  isPilotReady,
  nextSafeMilestone,
  sanitizeReadiness,
} from "@/lib/zooga-gateway/readiness";

export const Route = createFileRoute("/_app/system-readiness")({
  head: () => ({
    meta: [
      { title: "מוכנות מערכת — Zooga OS" },
      { name: "description", content: "תצוגת מוכנות מערכת לקריאה בלבד: שערי בטיחות, Shadow, בידוד לקוחות וביקורת." },
      { property: "og:title", content: "מוכנות מערכת — Zooga OS" },
      { property: "og:description", content: "שערי בטיחות, יכולות Gateway, מדדי Shadow ומוכנות Pilot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SystemReadinessPage,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-end">{value}</span>
    </div>
  );
}

function Gate({ on, label }: { on: boolean; label: string }) {
  return (
    <Row
      label={label}
      value={
        <Badge variant={on ? "destructive" : "secondary"} className="font-mono">
          {on ? "ON" : "OFF"}
        </Badge>
      }
    />
  );
}

function SystemReadinessPage() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/zooga/gateway-status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      setStatus((await res.json()) as GatewayStatus);
    } catch {
      setStatus(emptyStatus(new Date().toISOString(), "network_error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = useMemo(() => sanitizeReadiness(status?.readiness ?? null), [status?.readiness]);
  const blockers = useMemo(() => computeReadinessBlockers(status, readiness), [status, readiness]);
  const pilotReady = isPilotReady(blockers);

  return (
    <div dir="rtl" className="space-y-4" data-testid="system-readiness-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">מוכנות מערכת</h1>
          <p className="text-sm text-muted-foreground">
            תצוגה לקריאה בלבד. הריצה הקנונית היא {CANONICAL_RUNTIME_LABEL_HE}; אין כאן שום פעולה מבצעת.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="רענון">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        <span>כל דגלי התעבורה החיים כבויים. ל-Shadow Brain אין שום הרשאת ביצוע.</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">שערי בטיחות</h2>
          <Gate label="תעבורה חיה" on={!!status?.live_traffic} />
          <Gate label="Inbound" on={!!status?.inbound_enabled} />
          <Gate label="Outbound" on={!!status?.outbound_enabled} />
          <Gate label="Shadow Brain" on={status?.brain?.enabled === true} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">יכולות Gateway</h2>
          <Row label="נגישות" value={status?.reachable ? "נגיש" : `לא נגיש${status?.error_code ? ` · ${status.error_code}` : ""}`} />
          <Row label="בדיקה אחרונה" value={status?.checked_at ? new Date(status.checked_at).toLocaleString("he-IL") : "—"} />
          <Row label="השהיה" value={status?.latency_ms != null ? `${status.latency_ms} ms` : "—"} />
          <Row label="סביבה" value={status?.environment ?? "—"} />
          <Row
            label="מנוע Brain"
            value={readiness.brain_executor === "verified" ? "מאומת" : BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE}
          />
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">מדדי השוואת Shadow</h2>
          <Row label="ריצות פתוחות" value={status?.comparison?.open ?? 0} />
          <Row label="ריצות שהוכרעו" value={status?.comparison?.finalized ?? 0} />
          <Row label="שגיאות" value={status?.comparison?.errors ?? 0} />
          <Row label="הועברו / כשלים סופיים" value={`${status?.shadow?.delivered ?? 0} / ${status?.shadow?.dead ?? 0}`} />
          <Row
            label="חוזה canonical_action"
            value={
              readiness.contract.invalid_canonical_actions > 0
                ? `חריגה ב-${readiness.contract.invalid_canonical_actions} ריצות`
                : `תקין (${readiness.contract.checked_runs} ריצות)`
            }
          />
          {readiness.contract.invalid_action_samples.length > 0 && (
            <Row label="ערכים חורגים" value={<span className="font-mono">{readiness.contract.invalid_action_samples.join(", ")}</span>} />
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">בידוד לקוחות וביקורת</h2>
          <Row label="Tenant נוכחי" value={readiness.tenants.current_slug ?? "—"} />
          <Row label="מספר לקוחות" value={readiness.tenants.total} />
          <Row label="בידוד" value={readiness.tenants.isolation_enforced ? "מאומת" : "לא מאומת"} />
          <Row label="זיכרונות / היסטוריה" value={`${readiness.memory.contact_memories} / ${readiness.memory.profile_history}`} />
          <Row label="עקבות החלטה" value={readiness.memory.decision_traces} />
          <Row label="ביקורת (24 ש׳ / סה״כ)" value={`${readiness.memory.audit_events_recent} / ${readiness.memory.audit_events}`} />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">מוכנות Pilot</h2>
        <Row label="מצב" value={pilotReady ? "אין חסמים חוסמים" : "חסום"} />
        <Row label="אבן דרך בטוחה הבאה" value={nextSafeMilestone(blockers)} />
        <div className="mt-3 space-y-1">
          {blockers.length === 0 ? (
            <div className="text-sm text-muted-foreground">לא נמצאו חסמים בקריאה זו.</div>
          ) : (
            blockers.map((b) => (
              <div key={b.code} className="flex items-start gap-2 text-sm">
                <Badge variant={b.severity === "blocker" ? "destructive" : "secondary"} className="shrink-0">
                  {b.severity === "blocker" ? "חסם" : "אזהרה"}
                </Badge>
                <span>{b.label_he}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
