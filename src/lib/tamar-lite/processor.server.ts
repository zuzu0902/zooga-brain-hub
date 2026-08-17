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
    is_direct_question: !!p.is_direct_question,
    is_topic_shift: !!p.is_topic_shift,
    consent_granted: !!p.consent_granted,
  };
}

const MAX_ATTEMPTS = 5;

export async function processLiteBacklog(limit = 20, worker = "shadow"): Promise<{
  processed: number;
  skipped: number;
  failures: number;
  conflicts: number;
}> {
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
              .select(
                "consent_status,opted_out_at,human_owned,residence_city,region,interests,primary_goal,last_presented_offers",
              )
              .eq("id", contactId)
              .maybeSingle()
              .then((r: any) => r.data),
        // single source of truth for sellability
        db().from("offers_sellable").select("*").limit(100).then((r: any) => r.data ?? []),
      ]);

      const facts: Record<string, any> = {};
      const put = (k: string, v: any) => {
        if (v) facts[k] = { value_text: String(v), explicit_or_inferred: "explicit", confidence: 1 };
      };
      put("city", contact?.residence_city);
      put("region", (contact as any)?.region);
      put("interests", Array.isArray(contact?.interests) ? contact.interests.join(", ") : contact?.interests);
      put("primary_goal", contact?.primary_goal);

      const previouslyOffered = extractPreviouslyOffered(contact?.last_presented_offers);
      const candidates = selectLiteOffers(
        ((offers as any[]) ?? []).map(toLiteOffer),
        {
          interests: Array.isArray(contact?.interests) ? contact.interests.map(String) : [],
          region: (contact as any)?.region ?? null,
          prefers_abroad: null,
          style: null,
          previously_offered: previouslyOffered,
        },
      );

      const decision = reduceLite({
        conversation,
        inbound: toInbound(row),
        defs: DEFAULT_INTAKE_FIELDS,
        snapshot: { facts, skipped: [] },
        consentGranted: contact?.consent_status === "granted",
        optedOut: !!contact?.opted_out_at || contact?.consent_status === "denied",
        humanOwned: !!contact?.human_owned,
        offerCandidates: candidates.map((c) => c.offer_id),
      });

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
      });
      if (commitError) throw new Error(commitError.message ?? String(commitError));
      if (commit?.committed) processed++;
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
          error: String(err?.message ?? err).slice(0, 500),
        })
        .eq("id", row.id);
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