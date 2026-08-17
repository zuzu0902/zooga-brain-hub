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

/** Optimistic claim: only one worker may move an event out of `pending`. */
export async function claimLiteEvent(eventId: string, worker: string): Promise<boolean> {
  const { data } = await db()
    .from("tamar_lite_events")
    .update({ processing_state: "processing", error: null })
    .eq("id", eventId)
    .eq("processing_state", "pending")
    .select("id");
  if (!Array.isArray(data) || !data.length) return false;
  void worker;
  return true;
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

export async function processLiteBacklog(limit = 20, worker = "shadow"): Promise<{
  processed: number;
  skipped: number;
  failures: number;
}> {
  const settings = await getLiteSettings();
  let processed = 0;
  let skipped = 0;
  let failures = 0;

  const { data: rows } = await db()
    .from("tamar_lite_events")
    .select("*")
    .eq("processing_state", "pending")
    .eq("event_kind", "message")
    .order("meta_timestamp", { ascending: true, nullsFirst: true })
    .limit(limit);

  for (const row of (rows as any[]) ?? []) {
    if (!(await claimLiteEvent(row.id, worker))) {
      skipped++;
      continue;
    }
    try {
      const contactId: string | null = row.contact_id ?? null;
      const conversation = contactId ? await loadConversation(contactId) : defaultConversation("unknown");
      const [contact, offers] = await Promise.all([
        contactId
          ? db()
              .from("contacts")
              .select("consent_status,opted_out_at,human_owned,residence_city,region,interests,primary_goal")
              .eq("id", contactId)
              .maybeSingle()
              .then((r: any) => r.data)
          : Promise.resolve(null),
        db().from("offers").select("*").eq("status", "active").limit(100).then((r: any) => r.data ?? []),
      ]);

      const facts: Record<string, any> = {};
      const put = (k: string, v: any) => {
        if (v) facts[k] = { value_text: String(v), explicit_or_inferred: "explicit", confidence: 1 };
      };
      put("city", contact?.residence_city);
      put("region", (contact as any)?.region);
      put("interests", Array.isArray(contact?.interests) ? contact.interests.join(", ") : contact?.interests);
      put("primary_goal", contact?.primary_goal);

      const candidates = selectLiteOffers(
        (offers as LiteOffer[]) ?? [],
        {
          interests: Array.isArray(contact?.interests) ? contact.interests.map(String) : [],
          region: (contact as any)?.region ?? null,
          prefers_abroad: null,
          style: null,
          previously_offered: [],
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

      await db()
        .from("tamar_lite_decisions")
        .upsert(
          {
            event_id: row.id,
            contact_id: contactId,
            state_before: decision.state_before,
            state_after: decision.state_after,
            action: decision.action,
            facts: decision.facts,
            offer_ids: decision.action.offer_ids,
            reason_codes: decision.reason_codes,
            model_metadata: { adapter: "noop-shadow", mode: settings.mode, kill_switch: settings.kill_switch },
            shadow: true,
          },
          { onConflict: "event_id" } as any,
        );

      if (contactId) await saveConversation(decision.state_after);
      await db().from("tamar_lite_events").update({ processing_state: "processed" }).eq("id", row.id);
      processed++;
    } catch (err: any) {
      failures++;
      await db()
        .from("tamar_lite_events")
        .update({
          processing_state: "pending",
          attempts: (row.attempts ?? 0) + 1,
          error: String(err?.message ?? err).slice(0, 500),
        })
        .eq("id", row.id);
      await logLiteFailure("process_event", String(err?.message ?? err));
    }
  }

  return { processed, skipped, failures };
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

/** Optimistic version write: a concurrent worker's write is never clobbered. */
async function saveConversation(next: LiteConversation): Promise<boolean> {
  const expectedPrev = next.version - 1;
  const patch = {
    phase: next.phase,
    current_question_key: next.current_question_key,
    version: next.version,
    last_inbound_wamid: next.last_inbound_wamid,
    last_outbound_key: next.last_outbound_key,
    human_owned: next.human_owned,
  };
  const { data } = await db()
    .from("tamar_lite_conversations")
    .update(patch)
    .eq("contact_id", next.contact_id)
    .eq("version", expectedPrev)
    .select("contact_id");
  if (Array.isArray(data) && data.length) return true;
  const { error } = await db()
    .from("tamar_lite_conversations")
    .insert({ contact_id: next.contact_id, ...patch });
  return !error;
}