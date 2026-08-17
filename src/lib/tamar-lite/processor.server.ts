/**
 * TAMAR LITE — shadow processor.
 *
 * Reads pending lite events in meta_timestamp order per conversation,
 * claims them atomically, runs the pure reducer + pure sales selector and
 * writes ONE decision row. It never sends, never enqueues an outbox send,
 * and never writes to contacts / conversation_state / intake tables.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_INTAKE_FIELDS } from "@/lib/onboarding/baseline-intake";
import { reduceLite } from "./reducer";
import { selectLiteOffers, type LiteOffer } from "./sales-selector";
import { logLiteFailure } from "./events.server";
import { LITE_CONTACT_COLUMNS, isOptedOut, resolveLiteConsent } from "./consent";
import { loadCatalog } from "@/lib/offer-catalog/catalog.server";
import { matchOffer } from "@/lib/offer-catalog/match";
import { activeOfferFrom } from "@/lib/offer-catalog/active-offer";
import { resolveActiveOfferLock } from "@/lib/offer-catalog/active-offer-lock";
import { deriveCanonicalState, toLiteConversation } from "@/lib/canonical-state/state";
import { detectTopic, shouldAskIntakeQuestion } from "@/lib/intake-suppression";
import { getNextMissingIntakeQuestion } from "@/lib/intake-next-question";
import type { LiteConversation, LiteInbound } from "./types";

const db = () => supabaseAdmin as any;

export async function getLiteSettings(): Promise<{ mode: "shadow" | "live"; kill_switch: boolean }> {
  const { data } = await db().from("tamar_lite_settings").select("mode,kill_switch").eq("id", true).maybeSingle();
  return { mode: (data?.mode ?? "shadow") as "shadow" | "live", kill_switch: data?.kill_switch !== false };
}

function defaultConversation(contactId: string): LiteConversation {
  return {
    contact_id: contactId,
    phase: "awaiting_consent",
    current_question_key: null,
    version: 0,
    last_inbound_wamid: null,
    last_outbound_key: null,
    human_owned: false,
  };
}

/**
 * Atomic claim. `tamar_lite_claim_next` recovers stale `processing` rows left
 * by a crashed worker, then hands back at most ONE event per contact — always
 * the earliest by (meta_timestamp, created_at, id) — and never an event whose
 * contact_id is null. Conversation order can therefore not be inverted.
 */
export async function claimLiteEvents(limit: number, worker: string, staleSeconds = 300): Promise<any[]> {
  const { data, error } = await db().rpc("tamar_lite_claim_next", {
    p_worker: worker,
    p_limit: limit,
    p_stale_seconds: staleSeconds,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) throw new Error(error.message ?? String(error));
  return (data as any[]) ?? [];
}

/** offers_sellable exposes offer_url / matching_tags / target_region — map, never invent. */
export function toLiteOffer(row: any): LiteOffer {
  return {
    id: row.id,
    title: row.title ?? null,
    status: row.status ?? null,
    event_date: row.event_date ?? null,
    event_end_date: row.event_end_date ?? null,
    landing_page_url: row.offer_url ?? null,
    purchase_url: row.offer_url ?? null,
    category: row.category ?? null,
    region: row.target_region ?? null,
    tags: [
      ...(Array.isArray(row.matching_tags) ? row.matching_tags : []),
      ...(Array.isArray(row.target_interests) ? row.target_interests : []),
    ].map(String),
  };
}

function toInbound(row: any): LiteInbound {
  const p = row.payload ?? {};
  return {
    wamid: row.provider_event_id,
    text: String(p.text ?? ""),
    meta_timestamp: row.meta_timestamp ?? null,
    source_type: (p.source_type ?? "text") as LiteInbound["source_type"],
    is_opt_out: !!p.is_opt_out,
    is_handoff_request: !!p.is_handoff_request,
    handoff_declined: !!p.handoff_declined,
    is_direct_question: !!p.is_direct_question,
    is_topic_shift: !!p.is_topic_shift,
    consent_granted: !!p.consent_granted,
  };
}

const MAX_ATTEMPTS = 5;

/** Unique, unguessable lease token per run. Two runs never share a token. */
export function makeWorkerToken(prefix = "shadow"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}:${rand}`.slice(0, 200);
}

export async function processLiteBacklog(limit = 20, workerPrefix = "shadow"): Promise<{
  processed: number;
  skipped: number;
  failures: number;
  conflicts: number;
}> {
  // Fencing token: the claim stamps it on the row and the commit verifies it,
  // so a worker that wakes up after its lease expired can never commit onto a
  // lease that has since been re-claimed by somebody else.
  const worker = makeWorkerToken(workerPrefix);
  const settings = await getLiteSettings();
  let processed = 0;
  let skipped = 0;
  let failures = 0;
  let conflicts = 0;

  let rows: any[] = [];
  try {
    rows = await claimLiteEvents(limit, worker);
  } catch (err: any) {
    await logLiteFailure("claim_next", String(err?.message ?? err));
    return { processed, skipped, failures: failures + 1, conflicts };
  }

  for (const row of rows) {
    const contactIdGuard: string | null = row.contact_id ?? null;
    if (!contactIdGuard) {
      skipped++;
      continue;
    }
    try {
      const contactId: string = contactIdGuard;
      const conversation = await loadConversation(contactId);
      const [contact, offers] = await Promise.all([
        db()
              .from("contacts")
              .select(LITE_CONTACT_COLUMNS)
              .eq("id", contactId)
              .maybeSingle()
              .then((r: any) => {
                // never swallow: a failed read must retry, not look like "no consent"
                if (r.error) throw new Error(`contact_query_failed: ${r.error.message ?? r.error}`);
                if (!r.data) throw new Error("contact_query_failed: contact_not_found");
                return r.data;
              }),
        // single canonical catalog — identical source for live engine, V2 and Lite
        loadCatalog().then((c: { rows: any[] }) => c.rows),
      ]);

      const facts: Record<string, any> = {};
      const put = (k: string, v: any) => {
        if (v) facts[k] = { value_text: String(v), explicit_or_inferred: "explicit", confidence: 1 };
      };
      put("city", contact?.residence_city);
      put("region", (contact as any)?.region);
      put("interests", Array.isArray(contact?.interests) ? contact.interests.join(", ") : contact?.interests);

      const previouslyOffered = extractPreviouslyOffered(contact?.last_presented_offers);
      let candidates = selectLiteOffers(
        ((offers as any[]) ?? []).map(toLiteOffer),
        {
          interests: Array.isArray(contact?.interests) ? contact.interests.map(String) : [],
          region: (contact as any)?.region ?? null,
          prefers_abroad: null,
          style: null,
          previously_offered: previouslyOffered,
        },
      );

      // Deterministic destination/holiday intent wins over generic ranking so
      // Lite and the live engine always land on the SAME product.
      const liteInbound = toInbound(row);
      const { entries } = await loadCatalog();
      const sellableOfferIds = entries.filter((e: any) => e.sellable).map((e: any) => String(e.id));
      const catalogMatch = matchOffer({
        message: liteInbound.text,
        catalog: entries,
        activeOfferId: activeOfferFrom(contact)?.offer_id ?? null,
      });
      // The lock keeps the conversation on ONE product across follow-ups and
      // complaints, and only a confident explicit shift may replace it.
      const lock = resolveActiveOfferLock({
        active: activeOfferFrom(contact),
        match: catalogMatch,
        message: liteInbound.text,
        sellableOfferIds,
      });
      if (lock.offer_id) {
        const pinned = { offer_id: lock.offer_id, score: 999, match_facts: [lock.reason, ...catalogMatch.reasons] };
        candidates = [pinned, ...candidates.filter((c) => c.offer_id !== lock.offer_id)];
      }

      // ONE canonical state: live (`contacts`) and lite agree by construction.
      const snapshot = { facts, skipped: [] as string[] };
      const nextQuestion = getNextMissingIntakeQuestion(DEFAULT_INTAKE_FIELDS, snapshot);
      const suppression = shouldAskIntakeQuestion({
        questionKey: nextQuestion?.field_key ?? null,
        topic: detectTopic(liteInbound.text),
        directQuestion: liteInbound.is_direct_question,
      });
      const canonical = deriveCanonicalState({
        contact: { ...contact, id: contactId },
        lite: conversation,
        sellableOfferIds,
        nextQuestionKey: suppression.ask ? (nextQuestion?.field_key ?? null) : null,
        salesTurn: !!lock.offer_id || liteInbound.is_direct_question,
      });
      const aligned = toLiteConversation(canonical, conversation);

      const decision = reduceLite({
        conversation: { ...aligned, version: conversation.version },
        inbound: liteInbound,
        defs: DEFAULT_INTAKE_FIELDS,
        snapshot,
        consentGranted: resolveLiteConsent(contact as any),
        optedOut: isOptedOut(contact as any),
        humanOwned: !!contact?.human_owned,
        offerCandidates: candidates.map((c) => c.offer_id),
      });
      if (!suppression.ask) decision.reason_codes = [...decision.reason_codes, `intake_suppressed:${suppression.reason}`];

      // ONE atomic commit: conversation version + decision + event processed.
      const { data: commit, error: commitError } = await db().rpc("tamar_lite_commit_decision", {
        p_event_id: row.id,
        p_contact_id: contactId,
        p_expected_version: decision.state_before.version,
        p_state_before: decision.state_before,
        p_state_after: decision.state_after,
        p_action: decision.action,
        p_facts: decision.facts,
        p_offer_ids: decision.action.offer_ids,
        p_reason_codes: decision.reason_codes,
        p_model_metadata: { adapter: "noop-shadow", mode: settings.mode, kill_switch: settings.kill_switch },
        p_max_attempts: MAX_ATTEMPTS,
        p_worker_id: worker,
      });
      if (commitError) throw new Error(commitError.message ?? String(commitError));
      if (commit?.committed) processed++;
      else if (commit?.rejected) {
        skipped++;
        await logLiteFailure("commit_rejected", `event=${row.id} reason=${commit.rejected}`);
      }
      else {
        conflicts++;
        await logLiteFailure("commit_conflict", `event=${row.id} version=${decision.state_before.version}`);
      }
    } catch (err: any) {
      failures++;
      const attempts = (row.attempts ?? 0) + 1;
      await db()
        .from("tamar_lite_events")
        .update({
          processing_state: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          processing_started_at: null,
          worker_id: null,
          error: String(err?.message ?? err).slice(0, 500),
        })
        .eq("id", row.id)
        // only release a lease we still own
        .eq("worker_id", worker);
      await logLiteFailure("process_event", String(err?.message ?? err));
    }
  }

  return { processed, skipped, failures, conflicts };
}

/** contacts.last_presented_offers is jsonb: ids or objects with an offer id. */
export function extractPreviouslyOffered(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string") ids.push(item);
    else if (item && typeof item === "object") {
      const id = (item as any).offer_id ?? (item as any).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

async function loadConversation(contactId: string): Promise<LiteConversation> {
  const { data } = await db().from("tamar_lite_conversations").select("*").eq("contact_id", contactId).maybeSingle();
  if (!data) return defaultConversation(contactId);
  return {
    contact_id: contactId,
    phase: data.phase,
    current_question_key: data.current_question_key ?? null,
    version: data.version ?? 0,
    last_inbound_wamid: data.last_inbound_wamid ?? null,
    last_outbound_key: data.last_outbound_key ?? null,
    human_owned: !!data.human_owned,
  };
}

// Conversation state is committed ONLY inside `tamar_lite_commit_decision`,
// together with the decision and the event's processed flag. There is no
// separate write path, so a version conflict can never leave a decision behind.