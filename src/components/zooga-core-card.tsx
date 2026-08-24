import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldCheck, Server, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { emptyStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";
import { useT } from "@/lib/language-context";

const MIN_INTERVAL_MS = 30_000;

function Pill({ on, onLabel, offLabel, safeOff }: { on: boolean; onLabel: string; offLabel: string; safeOff?: boolean }) {
  const good = safeOff ? !on : on;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        good ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
      }`}
    >
      {on ? onLabel : offLabel}
    </span>
  );
}

export function ZoogaCoreCard({ initialStatus = null }: { initialStatus?: GatewayStatus | null } = {}) {
  const t = useT();
  const [status, setStatus] = useState<GatewayStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [draining, setDraining] = useState(false);
  const lastFetch = useRef(0);

  const drain = useCallback(async () => {
    setDraining(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/zooga/gateway-status", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      setStatus((await res.json()) as GatewayStatus);
    } catch {
      /* status-only action: a failure changes nothing */
    } finally {
      setDraining(false);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetch.current < MIN_INTERVAL_MS) return;
    lastFetch.current = now;
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
    load(true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, MIN_INTERVAL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const s = status;
  return (
    <Card className="p-5" dir="rtl" data-testid="zooga-core-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" /> {t("ליבת Zooga")}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading} aria-label={t("רענון")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs mb-1">Gateway</div>
          <Pill on={!!s?.reachable} onLabel={t("מחובר")} offLabel={t("מנותק")} />
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">Supabase</div>
          <Pill on={!!s?.integrations.supabase} onLabel={t("מחובר")} offLabel={t("לא מחובר")} />
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">{t("סביבה")}</div>
          <div className="font-medium">{s?.environment ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">{t("לקוח")}</div>
          <div className="font-medium">{s?.tenant ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">{t("תעבורה חיה")}</div>
          <Pill on={!!s?.live_traffic} onLabel="ON" offLabel="OFF" safeOff />
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">Inbound</div>
          <Pill on={!!s?.inbound_enabled} onLabel="ON" offLabel="OFF" safeOff />
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">Outbound</div>
          <Pill on={!!s?.outbound_enabled} onLabel="ON" offLabel="OFF" safeOff />
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">{t("נבדק לאחרונה")}</div>
          <div className="font-medium">
            {s?.checked_at ? new Date(s.checked_at).toLocaleTimeString("he-IL") : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">{t("זמן תגובה")}</div>
          <div className="font-medium">{s?.latency_ms != null ? `${s.latency_ms} ms` : "—"}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <span>{t("מצב בטיחות: תעבורה חיה כבויה, inbound ו-outbound כבויים. תצוגת סטטוס בלבד.")}</span>
      </div>

      {s?.error_code && (
        <div className="mt-2 text-xs text-muted-foreground" data-testid="zooga-core-error">
          {t("סטטוס לא זמין")}: {s.error_code}
        </div>
      )}
    </Card>
  );
}
