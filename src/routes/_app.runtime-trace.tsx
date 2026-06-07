import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/runtime-trace")({
  component: RuntimeTracePage,
});

type Row = {
  id: string;
  created_at: string;
  contact_id: string | null;
  campaign_id: string | null;
  offer_id: string | null;
  channel: string | null;
  source: string | null;
  inbound_message: string | null;
  outbound_reply: string | null;
  runtime_mode: string;
  conversation_mode: string | null;
  conversation_mode_reasons: string[] | null;
  runtime_pack_fetch_ok: boolean | null;
  fallback_reason: string | null;
  deployment_sha: string | null;
  composition_version: string | null;
  tamar_settings_version_at: string | null;
  prompt_blocks_injected: any;
  offer_intelligence_injected: boolean;
  campaign_injected: boolean;
  latency_ms: number | null;
  error: string | null;
  raw_payload: any;
};

function modeBadge(mode: string) {
  if (mode === "zooga_pack")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">zooga_pack</Badge>;
  if (mode === "zooga_direct")
    return (
      <Badge className="bg-indigo-600 hover:bg-indigo-600">
        zooga_direct · Zooga reply · Railway delivery
      </Badge>
    );
  if (mode === "fallback")
    return <Badge className="bg-amber-600 hover:bg-amber-600">fallback</Badge>;
  if (mode === "failed_before_reply")
    return <Badge variant="destructive">failed_before_reply</Badge>;
  return <Badge variant="secondary">{mode}</Badge>;
}

function conversationModeBadge(mode: string | null) {
  if (!mode) return <Badge variant="outline">mode: ?</Badge>;
  const cls =
    mode === "offer_specific"
      ? "bg-emerald-600 hover:bg-emerald-600"
      : mode === "generic_intake"
        ? "bg-sky-600 hover:bg-sky-600"
        : mode === "support"
          ? "bg-amber-600 hover:bg-amber-600"
          : mode === "handoff"
            ? "bg-rose-600 hover:bg-rose-600"
            : "";
  return <Badge className={cls}>mode: {mode}</Badge>;
}

function RuntimeTracePage() {
  const [modeFilter, setModeFilter] = useState<string>("");
  const [convModeFilter, setConvModeFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tamar_runtime_executions", modeFilter, convModeFilter],
    queryFn: async () => {
      let q = supabase
        .from("tamar_runtime_executions" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (modeFilter) q = q.eq("runtime_mode", modeFilter);
      if (convModeFilter) q = q.eq("conversation_mode", convModeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Runtime Trace</h1>
          <p className="text-sm text-muted-foreground">
            אמת הריצה של Tamar. זרימת ייצור (zooga_direct): Railway מקבל webhook → קורא ל-<span className="font-mono">POST /api/public/runtime/tamar-turn</span> → Zooga מייצר את <span className="font-mono">reply_text</span> → Railway שולח ל-WhatsApp. כל שורה כאן מייצגת תור שיחה אחד.
          </p>
        </div>
        <div className="flex gap-2">
          {["", "zooga_direct", "zooga_pack", "fallback", "failed_before_reply"].map((m) => (
            <Button
              key={m || "all"}
              size="sm"
              variant={modeFilter === m ? "default" : "outline"}
              onClick={() => setModeFilter(m)}
            >
              {m || "הכל"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            רענן
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">conversation mode:</span>
        {["", "generic_intake", "offer_specific", "support", "handoff"].map((m) => (
          <Button
            key={`cm-${m || "all"}`}
            size="sm"
            variant={convModeFilter === m ? "default" : "outline"}
            onClick={() => setConvModeFilter(m)}
          >
            {m || "all"}
          </Button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">טוען…</div>}
      {error && (
        <div className="text-sm text-destructive">שגיאה: {(error as Error).message}</div>
      )}
      {!isLoading && !error && (data ?? []).length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          עוד אין רשומות. Railway צריך להפעיל את <span className="font-mono">POST /api/public/runtime/tamar-turn</span> עבור כל הודעה נכנסת.
        </Card>
      )}

      <div className="space-y-3">
        {(data ?? []).map((r) => {
          const expanded = expandedId === r.id;
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {modeBadge(r.runtime_mode)}
                    {conversationModeBadge(r.conversation_mode)}
                    {r.runtime_pack_fetch_ok === true && (
                      <Badge variant="outline">
                        {r.runtime_mode === "zooga_direct" ? "turn_ok" : "pack_fetch_ok"}
                      </Badge>
                    )}
                    {r.runtime_pack_fetch_ok === false && (
                      <Badge variant="destructive">
                        {r.runtime_mode === "zooga_direct" ? "turn_failed" : "pack_fetch_failed"}
                      </Badge>
                    )}
                    {r.campaign_injected && <Badge variant="outline">campaign</Badge>}
                    {r.offer_intelligence_injected && (
                      <Badge variant="outline">offer_intel (active)</Badge>
                    )}
                    {!r.offer_intelligence_injected && r.offer_id && (
                      <Badge variant="outline" className="border-dashed">
                        offer resolved (background)
                      </Badge>
                    )}
                    {Array.isArray(r.prompt_blocks_injected) &&
                      r.prompt_blocks_injected.length > 0 && (
                        <Badge variant="outline">
                          blocks: {r.prompt_blocks_injected.length}
                        </Badge>
                      )}
                    {r.latency_ms != null && (
                      <span className="text-xs text-muted-foreground">
                        {r.latency_ms}ms
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  {r.fallback_reason && (
                    <div className="text-sm text-amber-700">
                      fallback_reason: <span className="font-mono">{r.fallback_reason}</span>
                    </div>
                  )}
                  {r.error && (
                    <div className="text-sm text-destructive">
                      error: <span className="font-mono">{r.error}</span>
                    </div>
                  )}
                  {r.inbound_message && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">נכנס: </span>
                      <span className="whitespace-pre-wrap">{r.inbound_message}</span>
                    </div>
                  )}
                  {r.outbound_reply && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">תשובה: </span>
                      <span className="whitespace-pre-wrap">{r.outbound_reply}</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-x-3 space-x-reverse">
                    {r.deployment_sha && <span>sha: {r.deployment_sha.slice(0, 10)}</span>}
                    {r.composition_version && <span>· comp: {r.composition_version}</span>}
                    {r.tamar_settings_version_at && (
                      <span>· settings@ {new Date(r.tamar_settings_version_at).toLocaleString()}</span>
                    )}
                    {r.contact_id && <span>· contact: {r.contact_id.slice(0, 8)}</span>}
                    {r.offer_id && <span>· resolved_offer_id: {r.offer_id.slice(0, 8)}</span>}
                    {Array.isArray(r.conversation_mode_reasons) &&
                      r.conversation_mode_reasons.length > 0 && (
                        <span>· reasons: {r.conversation_mode_reasons.join(", ")}</span>
                      )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                >
                  {expanded ? "הסתר" : "raw"}
                </Button>
              </div>
              {expanded && (
                <pre className="mt-3 p-3 bg-muted rounded text-xs overflow-auto max-h-96" dir="ltr">
                  {JSON.stringify(r, null, 2)}
                </pre>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}