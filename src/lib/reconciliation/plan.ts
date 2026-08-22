/**
 * CANONICAL RECONCILIATION — PURE PLANNER.
 *
 * Compares the three state surfaces (`contacts`, `tamar_lite_conversations`,
 * `manager_handoffs`) plus stuck `tamar_lite_events` against the ONE canonical
 * state (`@/lib/canonical-state/state`) and returns a list of proposed row
 * changes. It creates NO new source of truth, sends nothing, deletes nothing
 * and never re-plays an old event.
 *
 * The planner is pure: dry-run and apply share exactly the same plan.
 */
import { deriveCanonicalState } from "@/lib/canonical-state/state";

/** contact 6058 — explicitly excluded from every reconciliation action. */
export const PROTECTED_CONTACT_IDS = ["09613853-fc6e-48fb-bf01-32992e06d2ca"];

/** Only handoffs untouched before this instant may be treated as stale legacy. */
export const STALE_HANDOFF_BEFORE = "2026-08-17T00:00:00.000Z";

export const OPEN_HANDOFF_STATUSES = ["open", "queued", "notified", "pending"];

/** Terminal, non-processable state that already exists in the events table. */
export const TERMINAL_EVENT_STATE = "recorded";
export const LEGACY_EMPTY_PAYLOAD_REASON = "legacy_empty_payload_reconciled";

export type ReconcileActionKind =
  | "lite_state_align"
  | "event_terminal_skip"
  | "offer_lock_conflict_clear"
  | "handoff_stale_resolve";

export type ReconcileAction = {
  kind: ReconcileActionKind;
  table: "tamar_lite_conversations" | "tamar_lite_events" | "contacts" | "manager_handoffs";
  row_id: string;
  contact_id: string | null;
  reason: string;
  before: Record<string, any>;
  after: Record<string, any>;
};

export type ContactSurface = {
  contact: any;
  lite: any | null;
  nextQuestionKey: string | null;
  sellableOfferIds?: string[];
};

export type ReconcileInput = {
  contacts: ContactSurface[];
  handoffs: any[];
  /** events still waiting in the Lite backlog */
  pendingEvents: any[];
  now: string;
};

export function isProtected(contactId: string | null | undefined): boolean {
  return !!contactId && PROTECTED_CONTACT_IDS.includes(String(contactId));
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Hebrew/English destination aliases used only to DETECT a conflict. */
const DESTINATION_ALIASES: Record<string, string[]> = {
  דובאי: ["dubai", "דובאי", "אבו דאבי"],
  וייטנאם: ["vietnam", "וייטנאם", "ויאטנם"],
  תאילנד: ["thailand", "תאילנד"],
  יוון: ["greece", "יוון"],
};

function aliasesFor(value: string): string[] {
  const n = norm(value);
  for (const [key, list] of Object.entries(DESTINATION_ALIASES)) {
    if (norm(key) === n || list.some((a) => norm(a) === n)) return [norm(key), ...list.map(norm)];
  }
  return n ? [n] : [];
}

function mentions(haystack: string, value: string): boolean {
  const h = norm(haystack);
  return aliasesFor(value).some((a) => a && h.includes(a));
}

/** The explicit, customer-stated fields that must always survive. */
export function explicitDestination(contact: any): string | null {
  const dpf = contact?.dynamic_profile_fields ?? {};
  return dpf.destination || contact?.last_trip_destination || null;
}

/**
 * An engine-resolved offer lock conflicts when the customer explicitly stated
 * a different destination. Only the lock (and the engine-derived facts that
 * mirror it) are removed — no new product is ever chosen here.
 */
export function planOfferLockClear(contact: any): ReconcileAction | null {
  const dpf = contact?.dynamic_profile_fields ?? null;
  if (!dpf || typeof dpf !== "object") return null;
  const active = dpf.active_offer;
  const explicit = explicitDestination(contact);
  if (!active || !explicit) return null;
  if (String(active.reason ?? "") !== "engine_resolution") return null;
  const title = String(active.title ?? "");
  if (mentions(title, explicit)) return null; // lock agrees with the customer

  const after: Record<string, any> = { ...dpf };
  delete after.active_offer;

  const facts = dpf.conversation_facts;
  if (facts && typeof facts === "object") {
    const nextFacts: Record<string, any> = { ...facts };
    if (facts.destination && !mentions(String(facts.destination), explicit)) delete nextFacts.destination;
    if (dpf.special_requests && !facts.holiday) delete nextFacts.holiday;
    if (Object.keys(nextFacts).length) after.conversation_facts = nextFacts;
    else delete after.conversation_facts;
  }

  return {
    kind: "offer_lock_conflict_clear",
    table: "contacts",
    row_id: String(contact.id),
    contact_id: String(contact.id),
    reason: `active_offer_conflicts_with_explicit_destination:${explicit}`,
    before: { dynamic_profile_fields: dpf },
    after: { dynamic_profile_fields: after },
  };
}

/** Align the Lite mirror with the canonical state derived from `contacts`. */
export function planLiteAlign(surface: ContactSurface): ReconcileAction | null {
  const { contact, lite } = surface;
  if (!lite) return null;
  const canonical = deriveCanonicalState({
    contact,
    // the Lite row must never widen ownership — `contacts` is the authority
    lite: { ...lite, human_owned: false },
    sellableOfferIds: surface.sellableOfferIds,
    nextQuestionKey: surface.nextQuestionKey,
  });
  const target = {
    phase: canonical.phase,
    human_owned: canonical.human_owned,
    current_question_key: canonical.phase === "intake" ? canonical.current_question_key : null,
  };
  const before = {
    phase: lite.phase ?? null,
    human_owned: !!lite.human_owned,
    current_question_key: lite.current_question_key ?? null,
  };
  if (
    before.phase === target.phase &&
    before.human_owned === target.human_owned &&
    before.current_question_key === target.current_question_key
  ) {
    return null;
  }
  return {
    kind: "lite_state_align",
    table: "tamar_lite_conversations",
    row_id: String(lite.contact_id ?? contact.id),
    contact_id: String(contact.id),
    reason: "lite_diverged_from_canonical_state",
    before: { ...before, version: lite.version ?? 0 },
    after: { ...target, version: (lite.version ?? 0) + 1 },
  };
}

/** Corrupt legacy inbound (no text) — parked terminal, never processed. */
export function planEmptyEventSkip(event: any): ReconcileAction | null {
  if (String(event?.processing_state ?? "") !== "pending") return null;
  if (String(event?.event_kind ?? "") !== "message") return null;
  const text = event?.payload?.text;
  if (typeof text === "string" && text.trim().length > 0) return null;
  return {
    kind: "event_terminal_skip",
    table: "tamar_lite_events",
    row_id: String(event.id),
    contact_id: event.contact_id ? String(event.contact_id) : null,
    reason: LEGACY_EMPTY_PAYLOAD_REASON,
    before: { processing_state: event.processing_state, error: event.error ?? null },
    after: { processing_state: TERMINAL_EVENT_STATE, error: LEGACY_EMPTY_PAYLOAD_REASON },
  };
}

/**
 * Stale legacy handoff: untouched before the cutoff, still in an open status,
 * and canonically NOT owned by a human (or with no contact at all).
 */
export function planStaleHandoff(
  handoff: any,
  contactById: Map<string, any>,
  now: string,
): ReconcileAction | null {
  const status = String(handoff?.status ?? "");
  if (!OPEN_HANDOFF_STATUSES.includes(status)) return null;
  if (!handoff?.updated_at || String(handoff.updated_at) >= STALE_HANDOFF_BEFORE) return null;
  const contactId = handoff.contact_id ? String(handoff.contact_id) : null;
  if (isProtected(contactId)) return null;
  if (contactId) {
    const contact = contactById.get(contactId);
    if (!contact) return null; // unknown contact — never guess
    if (contact.human_owned) return null; // live, valid ownership
  }
  return {
    kind: "handoff_stale_resolve",
    table: "manager_handoffs",
    row_id: String(handoff.id),
    contact_id: contactId,
    reason: "canonical_reconciliation_stale_legacy",
    before: { status, resolved_at: handoff.resolved_at ?? null },
    after: { status: "resolved", resolved_at: now, note: "canonical_reconciliation_stale_legacy" },
  };
}

export function planReconciliation(input: ReconcileInput): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  const contactById = new Map<string, any>();
  for (const s of input.contacts) if (s.contact?.id) contactById.set(String(s.contact.id), s.contact);

  for (const surface of input.contacts) {
    const id = String(surface.contact?.id ?? "");
    if (isProtected(id)) continue;
    const lock = planOfferLockClear(surface.contact);
    if (lock) actions.push(lock);
    const contactForState = lock
      ? { ...surface.contact, dynamic_profile_fields: (lock.after as any).dynamic_profile_fields }
      : surface.contact;
    const align = planLiteAlign({ ...surface, contact: contactForState });
    if (align) actions.push(align);
  }

  for (const ev of input.pendingEvents) {
    if (isProtected(ev?.contact_id)) continue;
    const a = planEmptyEventSkip(ev);
    if (a) actions.push(a);
  }

  for (const h of input.handoffs) {
    const a = planStaleHandoff(h, contactById, input.now);
    if (a) actions.push(a);
  }

  return actions;
}

export function summarize(actions: ReconcileAction[]): Record<ReconcileActionKind, number> {
  const out: Record<string, number> = {
    lite_state_align: 0,
    event_terminal_skip: 0,
    offer_lock_conflict_clear: 0,
    handoff_stale_resolve: 0,
  };
  for (const a of actions) out[a.kind] = (out[a.kind] ?? 0) + 1;
  return out as Record<ReconcileActionKind, number>;
}

export function maskRowId(id: string | null): string | null {
  if (!id) return null;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}
