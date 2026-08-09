/**
 * ZERO-LOSS CONTROL CENTER — קליטה, תור, הסגר, זהויות, התאמה ומוכנות.
 * כל הנתונים מגיעים ממוסכים (masked) מהשרת; אין PII גולמי בדפדפן.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getZeroLossOverview,
  listReconciliationRuns,
  listZeroLossExceptions,
  relinkIdentity,
  resolveQuarantine,
  retryVaultEvent,
  runReconciliationNow,
  runZeroLossBackfill,
  searchIdentities,
} from "@/lib/zero-loss.functions";

export const Route = createFileRoute("/_app/zero-loss")({
  component: ZeroLossPage,
  head: () => ({
    meta: [
      { title: "Zero-Loss Control Center · Zooga" },
      { name: "description", content: "ניטור קליטה, תור עיבוד, הסגר ומרשם זהויות של Zooga." },
      { property: "og:title", content: "Zero-Loss Control Center · Zooga" },
      { property: "og:description", content: "ניטור אפס אובדן לאירועי WhatsApp של Zooga." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Metric({ label, value, tone }: { label: string; value: string | number | null; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={`text-2xl font-bold ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : ""}`}
      >
        {value === null || value === undefined ? "—" : value}
      </div>
    </div>
  );
}

function ZeroLossPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const overviewFn = useServerFn(getZeroLossOverview);
  const exceptionsFn = useServerFn(listZeroLossExceptions);
  const runsFn = useServerFn(listReconciliationRuns);
  const searchFn = useServerFn(searchIdentities);

  const overview = useQuery({ queryKey: ["zl", "overview"], queryFn: () => overviewFn({}) });
  const exceptions = useQuery({ queryKey: ["zl", "exceptions"], queryFn: () => exceptionsFn({}) });
  const runs = useQuery({ queryKey: ["zl", "runs"], queryFn: () => runsFn({}) });
  const identities = useQuery({
    queryKey: ["zl", "identities", query],
    queryFn: () => searchFn({ data: { query } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["zl"] });

  const reconcile = useMutation({
    mutationFn: useServerFn(runReconciliationNow),
    onSuccess: (r: any) => {
      toast.success(`ריצת התאמה הושלמה · ${r.repaired} תיקונים`);
      invalidate();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const retry = useMutation({
    mutationFn: useServerFn(retryVaultEvent),
    onSuccess: () => {
      toast.success("האירוע הוחזר לתור העיבוד");
      invalidate();
    },
  });
  const resolve = useMutation({
    mutationFn: useServerFn(resolveQuarantine),
    onSuccess: () => {
      toast.success("החריג סומן כטופל");
      invalidate();
    },
  });
  const relink = useMutation({
    mutationFn: useServerFn(relinkIdentity),
    onSuccess: (r: any) => {
      toast.success(r.contact_id ? "הזהות קושרה לאיש קשר" : "לא נמצא איש קשר תואם");
      invalidate();
    },
  });
  const backfill = useMutation({
    mutationFn: useServerFn(runZeroLossBackfill),
    onSuccess: (r: any) =>
      toast.success(
        `Dry-run: ${r.identities_missing} זהויות חסרות · ${r.vault_candidates} אירועי legacy · ${r.contacts_scanned} אנשי קשר נסרקו`,
      ),
  });

  const m = overview.data?.metrics;
  const gate = overview.data?.gate;
  const banner = overview.data?.health_banner;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Zero-Loss Control Center</h1>
          <p className="text-sm text-muted-foreground">
            אפס אובדן לכל אירוע שהגיע לשרת · כל מספר נשמר · כל פער מזוהה
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => backfill.mutate({ data: { dryRun: true } })} disabled={backfill.isPending}>
            Backfill dry-run
          </Button>
          <Button onClick={() => reconcile.mutate({})} disabled={reconcile.isPending}>
            הרץ התאמה עכשיו
          </Button>
        </div>
      </div>

      {banner && banner !== "ok" && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <span className="font-semibold">מצב מערכת: מושפע</span> — קיימים חריגים בהסגר, dead-letter או outbox תקוע.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="נקלטו 24 שעות" value={m?.ingested_24h ?? null} />
        <Metric label="נקלטו 7 ימים" value={m?.ingested_7d ?? null} />
        <Metric label="עובדו 24 שעות" value={m?.processed_24h ?? null} />
        <Metric label="ממתינים בתור" value={m?.pending ?? null} />
        <Metric label="בניסיון חוזר" value={m?.retrying ?? null} tone="warn" />
        <Metric label="בהסגר" value={m?.quarantined ?? null} tone={m?.quarantined ? "bad" : undefined} />
        <Metric label="Dead-letter" value={m?.dead_letter ?? null} tone={m?.dead_letter ? "bad" : undefined} />
        <Metric label="זהויות ללא איש קשר" value={m?.orphan_identities ?? null} tone="warn" />
        <Metric label="Outbox תקוע" value={m?.stuck_outbox ?? null} tone={m?.stuck_outbox ? "bad" : undefined} />
        <Metric
          label="p95 זמן עיבוד"
          value={m?.p95_processing_ms != null ? `${Math.round(m.p95_processing_ms)}ms` : "אין מדידה"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Production Readiness — {gate?.production_ready ? "READY" : "חסום"} ({gate?.verified_count}/{gate?.total})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(overview.data?.readiness ?? []).map((r: any) => (
            <div key={r.key} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 text-sm">
              <div>
                <div className="font-medium">
                  {r.label} {!r.essential && <span className="text-[10px] text-muted-foreground">(לא חוסם)</span>}
                </div>
                <div className="text-xs text-muted-foreground">{r.evidence}</div>
              </div>
              <Badge variant={r.verified ? "default" : "outline"}>{r.verified ? "VERIFIED" : "NOT VERIFIED"}</Badge>
            </div>
          ))}
          <div className="text-xs text-muted-foreground pt-1">
            PITR/גיבוי, load test ו-restore drill אינם ניתנים לאימות מתוך האפליקציה ולכן מסומנים NOT VERIFIED עד לאימות ידני.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">חריגים בהסגר</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(exceptions.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">אין חריגים פתוחים.</div>}
          {(exceptions.data ?? []).map((e: any) => (
            <div key={e.id} className="rounded-md border border-border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={e.severity === "critical" ? "destructive" : "outline"}>{e.reason_code}</Badge>
                <span className="text-xs text-muted-foreground">{e.event_type ?? "—"}</span>
                <span className="text-xs font-mono">{e.phone_masked ?? "—"}</span>
                <span className="text-xs text-muted-foreground">correlation: {String(e.correlation_id ?? "").slice(0, 8)}</span>
                <span className="text-xs text-muted-foreground">ניסיונות: {e.attempt_count}</span>
                <span className="text-xs text-muted-foreground">{e.resolution_status}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!e.vault_event_id || retry.isPending}
                  onClick={() => {
                    if (confirm("להחזיר את האירוע לתור העיבוד?")) retry.mutate({ data: { vaultEventId: e.vault_event_id } });
                  }}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={resolve.isPending}
                  onClick={() => {
                    if (confirm("לסמן את החריג כטופל?")) resolve.mutate({ data: { id: e.id, status: "resolved" } });
                  }}
                >
                  Resolve
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Phone Identity Registry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי מספר או סיומת"
            className="max-w-xs"
          />
          <div className="space-y-1">
            {(identities.data ?? []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{i.phone_masked}</span>
                  <Badge variant={i.state === "linked" ? "default" : "outline"}>{i.state}</Badge>
                  <span className="text-xs text-muted-foreground">{i.source ?? "—"}</span>
                </div>
                {i.state === "orphan" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => relink.mutate({ data: { identityId: i.id } })}>
                      Relink
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("ליצור איש קשר חדש עבור המספר?"))
                          relink.mutate({ data: { identityId: i.id, createContact: true } });
                      }}
                    >
                      צור איש קשר
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {(identities.data ?? []).length === 0 && <div className="text-sm text-muted-foreground">אין תוצאות.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ריצות התאמה</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(runs.data?.runs ?? []).length === 0 && (
            <div className="text-muted-foreground">טרם בוצעה ריצת התאמה. Scheduler: NOT SCHEDULED.</div>
          )}
          {(runs.data?.runs ?? []).map((r: any) => (
            <div key={r.id} className="border-b border-border/60 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{r.trigger_source}</Badge>
                <span>{new Date(r.started_at).toLocaleString("he-IL")}</span>
                <span className="text-xs text-muted-foreground">
                  ממצאים: {r.findings_count} · תיקונים: {r.repaired_count} · {r.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {(runs.data?.findings ?? [])
                  .filter((f: any) => f.run_id === r.id && f.count > 0)
                  .map((f: any) => (
                    <Badge key={f.id} variant={f.severity === "critical" ? "destructive" : "outline"}>
                      {f.finding_type}: {f.count}
                      {f.action_taken ? ` · ${f.action_taken}` : ""}
                    </Badge>
                  ))}
              </div>
            </div>
          ))}
          <div className="text-xs text-muted-foreground">
            גיבוי/PITR: presence בלבד — לא ניתן לאמת מתוך האפליקציה.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}