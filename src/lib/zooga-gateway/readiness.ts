/**
 * ZOOGA OS — SYSTEM READINESS (pure, client-safe, deterministic).
 *
 * Read-only truth projection for the Control Center. Contains NO network call,
 * NO secret, NO customer data. Every field is an aggregate count, an enum, or a
 * boolean; unknown keys from any upstream source are dropped.
 *
 * Safety invariants encoded here:
 *  - Tamar legacy runtime is canonical. The Shadow Brain has zero authority.
 *  - Every traffic flag defaults to the SAFE value (false / OFF).
 *  - A capability is "not verified" unless a positive signal proves otherwise.
 */
import { SHADOW_BRAIN_ACTIONS } from "./shadow-brain-contract";
import type { GatewayStatus } from "./status";

export const CANONICAL_RUNTIME = "tamar_legacy" as const;
export const CANONICAL_RUNTIME_LABEL_HE = "תמר (Legacy) — קנוני";

/** Actions a Gateway Brain proposal may ever contain. */
const BRAIN_ACTION_SET = new Set<string>(SHADOW_BRAIN_ACTIONS);

/** Short enum-ish values only — never free text, never customer content. */
const ENUM_RE = /^[a-z0-9_.:-]{1,32}$/i;

/** Keys that must never be surfaced even if an upstream source supplies them. */
const SECRET_KEY_RE =
  /(token|secret|key|password|passwd|authorization|bearer|credential|prompt|payload|input_signals|env)/i;

export type BrainExecutorState = "not_verified" | "verified";

export type TenantReadiness = {
  total: number;
  current_slug: string | null;
  isolation_enforced: boolean;
};

export type MemoryReadiness = {
  contact_memories: number;
  profile_history: number;
  decision_traces: number;
  audit_events: number;
  audit_events_recent: number;
  available: boolean;
};

export type ContractReadiness = {
  checked_runs: number;
  invalid_canonical_actions: number;
  invalid_action_samples: string[];
};

export type ZoogaReadiness = {
  canonical_runtime: typeof CANONICAL_RUNTIME;
  brain_executor: BrainExecutorState;
  tenants: TenantReadiness;
  memory: MemoryReadiness;
  contract: ContractReadiness;
};

export const EMPTY_READINESS: ZoogaReadiness = {
  canonical_runtime: CANONICAL_RUNTIME,
  brain_executor: "not_verified",
  tenants: { total: 0, current_slug: null, isolation_enforced: false },
  memory: {
    contact_memories: 0,
    profile_history: 0,
    decision_traces: 0,
    audit_events: 0,
    audit_events_recent: 0,
    available: false,
  },
  contract: { checked_runs: 0, invalid_canonical_actions: 0, invalid_action_samples: [] },
};

function count(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function slug(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return ENUM_RE.test(s) ? s : null;
}

/** True only when the value is a Brain-allowed proposal action. */
export function isBrainProposalAction(v: unknown): boolean {
  return typeof v === "string" && BRAIN_ACTION_SET.has(v.trim().toLowerCase());
}

/** Bounded, enum-only sample list of offending canonical actions. */
export function collectInvalidCanonicalActions(actions: readonly unknown[], max = 5): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (typeof a !== "string") continue;
    const s = a.trim().toLowerCase();
    if (!s || !ENUM_RE.test(s) || isBrainProposalAction(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Drops every key that is not part of the readiness allow-list, and any
 * secret-like key, then coerces each value to its safe type.
 */
export function sanitizeReadiness(raw: unknown): ZoogaReadiness {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredReadinessClone();
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (SECRET_KEY_RE.test(k)) delete r[k];
  }
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const tenants = obj(r["tenants"]);
  const memory = obj(r["memory"]);
  const contract = obj(r["contract"]);

  const mem: MemoryReadiness = {
    contact_memories: count(memory["contact_memories"]),
    profile_history: count(memory["profile_history"]),
    decision_traces: count(memory["decision_traces"]),
    audit_events: count(memory["audit_events"]),
    audit_events_recent: count(memory["audit_events_recent"]),
    available: memory["available"] === true,
  };

  const samples = Array.isArray(contract["invalid_action_samples"])
    ? collectInvalidCanonicalActions(contract["invalid_action_samples"] as unknown[])
    : [];

  return {
    canonical_runtime: CANONICAL_RUNTIME,
    // A positive, explicit signal is required. Anything else is "not verified".
    brain_executor: r["brain_executor"] === "verified" ? "verified" : "not_verified",
    tenants: {
      total: count(tenants["total"]),
      current_slug: slug(tenants["current_slug"]),
      isolation_enforced: tenants["isolation_enforced"] === true,
    },
    memory: mem,
    contract: {
      checked_runs: count(contract["checked_runs"]),
      invalid_canonical_actions: count(contract["invalid_canonical_actions"]),
      invalid_action_samples: samples,
    },
  };
}

function structuredReadinessClone(): ZoogaReadiness {
  return {
    ...EMPTY_READINESS,
    tenants: { ...EMPTY_READINESS.tenants },
    memory: { ...EMPTY_READINESS.memory },
    contract: { ...EMPTY_READINESS.contract, invalid_action_samples: [] },
  };
}

export type BlockerSeverity = "blocker" | "warning";

export type ReadinessBlocker = {
  code: string;
  severity: BlockerSeverity;
  label_he: string;
};

export const BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE =
  "מנוע ה-Brain ב-Gateway אינו מאומת / אינו מותקן";

/**
 * Deterministic blocker calculation. Ordered by severity then discovery order,
 * so the first entry is always the most important thing to resolve.
 */
export function computeReadinessBlockers(
  status: GatewayStatus | null | undefined,
  readiness: ZoogaReadiness,
): ReadinessBlocker[] {
  const out: ReadinessBlocker[] = [];
  const push = (code: string, severity: BlockerSeverity, label_he: string) =>
    out.push({ code, severity, label_he });

  if (!status?.reachable) {
    push("gateway_unreachable", "blocker", "ה-Gateway אינו נגיש — נדרשת בדיקה ב-Hostinger");
  }
  if (!status?.integrations?.supabase) {
    push("gateway_db_link_unverified", "warning", "ה-Gateway אינו מדווח על חיבור בסיס נתונים מאומת");
  }
  if (readiness.contract.invalid_canonical_actions > 0) {
    push(
      "shadow_contract_violation",
      "blocker",
      `חריגת חוזה Shadow: ${readiness.contract.invalid_canonical_actions} ריצות עם canonical_action מחוץ לרשימת ההיתר` +
        (readiness.contract.invalid_action_samples.length
          ? ` (${readiness.contract.invalid_action_samples.join(", ")})`
          : ""),
    );
  }
  if (readiness.brain_executor !== "verified") {
    push("brain_executor_not_verified", "blocker", BRAIN_EXECUTOR_UNVERIFIED_LABEL_HE);
  }
  if (!readiness.tenants.isolation_enforced || readiness.tenants.total < 1) {
    push("tenant_isolation_unverified", "blocker", "בידוד לקוחות (tenant) אינו מאומת");
  }
  if (!readiness.memory.available) {
    push("memory_audit_unavailable", "warning", "שכבת זיכרון/היסטוריה/ביקורת אינה זמינה לקריאה");
  }
  if (status?.live_traffic || status?.inbound_enabled || status?.outbound_enabled) {
    push("live_flags_on", "blocker", "דגלי תעבורה חיים דלוקים — בשלב זה כולם חייבים להיות כבויים");
  }
  if ((status?.shadow?.dead ?? 0) > 0) {
    push("shadow_transport_dead_letters", "warning", "קיימים כשלים סופיים בהעברת Shadow");
  }
  if ((status?.comparison?.open ?? 0) > 0) {
    push("shadow_runs_open", "warning", "קיימות ריצות Shadow פתוחות שלא הוכרעו");
  }

  const rank = (b: ReadinessBlocker) => (b.severity === "blocker" ? 0 : 1);
  return out.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
}

export function isPilotReady(blockers: readonly ReadinessBlocker[]): boolean {
  return !blockers.some((b) => b.severity === "blocker");
}

/** The single next safe step. Never suggests enabling live traffic. */
export function nextSafeMilestone(blockers: readonly ReadinessBlocker[]): string {
  const first = blockers.find((b) => b.severity === "blocker") ?? blockers[0];
  switch (first?.code) {
    case "gateway_unreachable":
      return "להחזיר את ה-Gateway ב-Hostinger למצב נגיש ולאמת בדיקת סטטוס אחת מוצלחת";
    case "shadow_contract_violation":
      return "ליישר את ערכי canonical_action לרשימת ההיתר של הצעות ה-Brain, ואז להריץ השוואה מחדש";
    case "brain_executor_not_verified":
      return "להתקין ולאמת את מנוע ה-Brain ב-Gateway במצב Shadow בלבד (ללא הרשאת ביצוע)";
    case "tenant_isolation_unverified":
      return "לאמת רשומת tenant פעילה יחידה ובידוד קריאה לפי tenant_id";
    case "live_flags_on":
      return "לכבות מחדש את כל דגלי התעבורה החיים לפני כל צעד נוסף";
    case "gateway_db_link_unverified":
      return "לאמת את חיבור ה-Gateway לבסיס הנתונים ולהריץ בדיקת סטטוס נוספת";
    case "memory_audit_unavailable":
      return "לאמת קריאה לשכבת הזיכרון וההיסטוריה לפני הרחבת ההשוואה";
    case "shadow_transport_dead_letters":
      return "לבדוק את הכשלים הסופיים בהעברת Shadow ולנקז מחדש";
    case "shadow_runs_open":
      return "להכריע את ריצות ה-Shadow הפתוחות לאחר שהמוח יאומת";
    default:
      return "להרחיב את חלון ההשוואה ב-Shadow לפני שוקלים Pilot — ללא הפעלת תעבורה";
  }
}
