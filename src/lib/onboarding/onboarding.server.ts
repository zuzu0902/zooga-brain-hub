/**
 * STAGE 1 server layer: contact resolution, onboarding state, profile facts,
 * and the send-decision preview used by import/campaign screens.
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, splitName } from "@/lib/phone";
import { routeConversationStart } from "./decision-router";
import { completeness, DEFAULT_INTAKE_FIELDS, nextIntakeStep } from "./baseline-intake";
import { extractFieldsFromFreeText } from "./baseline-intake";
import { mergeFact, type IncomingFact } from "./profile-facts";
import {
  CONSENT_VERSION,
  OPENING_TEMPLATE_NAME,
  type IntakeFieldDefinition,
  type ProfileFact,
  type RoutableContact,
  type RouterResult,
} from "./types";

const db = () => supabaseAdmin as any;

export async function loadIntakeDefs(version = 1): Promise<IntakeFieldDefinition[]> {
  const { data } = await db()
    .from("intake_field_definitions")
    .select("*")
    .eq("intake_version", version)
    .order("order_index", { ascending: true });
  const rows = (data as any[]) ?? [];
  if (!rows.length) return DEFAULT_INTAKE_FIELDS;
  return rows.map((r) => ({
    field_key: r.field_key,
    label: r.label,
    question_text: r.question_text,
    purpose_text: r.purpose_text ?? null,
    presentation: (r.presentation ?? "text") as IntakeFieldDefinition["presentation"],
    options: Array.isArray(r.options) ? r.options : [],
    required: !!r.required,
    skippable: r.skippable !== false,
    order_index: Number(r.order_index ?? 0),
    enabled: r.enabled !== false,
    stage: (r.stage ?? (r.field_key === "birth_date" ? "progressive" : "baseline")) as IntakeFieldDefinition["stage"],
  }));
}

export async function loadFacts(contactId: string): Promise<Record<string, ProfileFact>> {
  const { data } = await db()
    .from("contact_profile_facts")
    .select("*")
    .eq("contact_id", contactId)
    .eq("is_current", true);
  const out: Record<string, ProfileFact> = {};
  for (const r of ((data as any[]) ?? [])) {
    out[r.field_key] = {
      field_key: r.field_key,
      value_text: r.value_text ?? null,
      value_json: r.value_json ?? null,
      explicit_or_inferred: r.explicit_or_inferred,
      confidence: Number(r.confidence ?? 0),
      source: r.source ?? "tamar",
      source_message_id: r.source_message_id ?? null,
      evidence: r.evidence ?? null,
      observed_at: r.observed_at ?? r.created_at,
    };
  }
  return out;
}

/** Contact columns that are themselves explicit facts (entered by staff/source). */
function factsFromContactRow(row: any): Record<string, ProfileFact> {
  const out: Record<string, ProfileFact> = {};
  const add = (key: string, value: unknown) => {
    const v = Array.isArray(value) ? value.filter(Boolean).join(", ") : value;
    if (v == null || String(v).trim() === "") return;
    out[key] = {
      field_key: key,
      value_text: String(v),
      explicit_or_inferred: "explicit",
      confidence: 95,
      source: "crm",
      source_message_id: null,
      evidence: "שדה CRM",
      observed_at: row.updated_at ?? row.created_at,
    };
  };
  add("first_name", row.first_name);
  add("city", row.city ?? row.region);
  add("birth_date", row.birth_date);
  add("interests", row.interests);
  return out;
}

export function toRoutableContact(row: any): RoutableContact {
  return {
    id: row.id,
    phone: row.phone ?? null,
    whatsapp_number: row.whatsapp_number ?? null,
    opening: {
      opening_status: (row.opening_status ?? "not_sent") as RoutableContact["opening"]["opening_status"],
      opening_asked_at: row.opening_asked_at ?? null,
      opening_responded_at: row.opening_responded_at ?? null,
      opening_deferred_at: row.opening_deferred_at ?? null,
    },
    consent: {
      consent_status: row.consent_status ?? "unknown",
      consent_source: row.consent_source ?? null,
      consent_at: row.consent_date ?? null,
      consent_version: row.consent_version ?? null,
      consent_evidence: row.consent_evidence ?? {},
      opt_out_at: row.opted_out_at ?? null,
    },
    intake: {
      baseline_intake_status: row.baseline_intake_status ?? "not_started",
      intake_version: Number(row.intake_version ?? 1),
      started_at: row.intake_started_at ?? null,
      completed_at: row.intake_completed_at ?? null,
      last_step_id: row.intake_last_step_id ?? null,
    },
    conversation: {
      first_seen_at: row.first_seen_at ?? row.created_at ?? null,
      first_inbound_at: row.first_inbound_at ?? null,
      last_inbound_at: row.last_inbound_at ?? row.last_interaction_at ?? null,
      last_outbound_at: row.last_outbound_at ?? null,
      total_messages: Number(row.total_messages ?? 0),
      has_prior_conversation: !!row.has_prior_conversation,
      service_window_open_until: row.service_window_open_until ?? null,
    },
  };
}

export async function findContactByPhone(rawPhone: string | null | undefined) {
  const phone = normalizePhone(rawPhone ?? null);
  if (!phone) return null;
  const { data } = await db()
    .from("contacts")
    .select("*")
    .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

/** Idempotent creation keyed on the normalized WhatsApp number. */
export async function resolveOrCreateContact(args: {
  phone: string;
  fullName?: string | null;
  source?: string;
  optInEvidence?: Record<string, unknown> | null;
}): Promise<{ contact: any; created: boolean }> {
  const phone = normalizePhone(args.phone);
  if (!phone) throw new Error("invalid_phone");
  const existing = await findContactByPhone(phone);
  if (existing) return { contact: existing, created: false };
  const { first, last } = splitName(args.fullName ?? null);
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("contacts")
    .insert({
      phone,
      whatsapp_number: phone,
      full_name: args.fullName ?? null,
      first_name: first,
      last_name: last,
      source: (args.source as any) ?? "Manual",
      status: "new_lead",
      consent_status: "unknown",
      consent_evidence: args.optInEvidence ?? {},
      baseline_intake_status: "not_started",
      first_seen_at: now,
    })
    .select("*")
    .single();
  if (error) {
    const again = await findContactByPhone(phone);
    if (again) return { contact: again, created: false };
    throw error;
  }
  return { contact: data, created: true };
}

// -------------------------------------------------------------- consent

/** Append-only audit trail. Idempotent per (contact, event, source message). */
export async function recordOnboardingEvent(args: {
  contactId: string;
  eventType: string;
  stage?: string | null;
  buttonId?: string | null;
  buttonTitle?: string | null;
  sourceMessageId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ recorded: boolean; duplicate: boolean }> {
  const { error } = await db().from("onboarding_events").insert({
    contact_id: args.contactId,
    event_type: args.eventType,
    stage: args.stage ?? null,
    button_id: args.buttonId ?? null,
    button_title: args.buttonTitle ?? null,
    source_message_id: args.sourceMessageId ?? null,
    payload: args.payload ?? {},
  });
  if (error) {
    if (String(error.code) === "23505") return { recorded: false, duplicate: true };
    throw new Error(error.message);
  }
  return { recorded: true, duplicate: false };
}

export async function markOpeningSent(contactId: string) {
  const now = new Date().toISOString();
  await db()
    .from("contacts")
    .update({ opening_status: "asked", opening_asked_at: now })
    .eq("id", contactId);
  await recordOnboardingEvent({ contactId, eventType: "opening_sent", stage: "opening" });
}

/**
 * Availability answer. NEVER writes consent — "לא עכשיו" only defers.
 */
export async function setOpeningStatus(
  contactId: string,
  status: "available" | "deferred",
  meta: { buttonId?: string | null; buttonTitle?: string | null; sourceMessageId?: string | null } = {},
) {
  const now = new Date().toISOString();
  await db()
    .from("contacts")
    .update({
      opening_status: status,
      opening_responded_at: now,
      opening_deferred_at: status === "deferred" ? now : null,
      service_window_open_until:
        status === "available" ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : undefined,
    })
    .eq("id", contactId);
  await recordOnboardingEvent({
    contactId,
    eventType: status === "available" ? "opening_available_yes" : "opening_not_now",
    stage: "opening",
    buttonId: meta.buttonId ?? null,
    buttonTitle: meta.buttonTitle ?? null,
    sourceMessageId: meta.sourceMessageId ?? null,
  });
}

export async function setConsent(
  contactId: string,
  granted: boolean,
  evidence: Record<string, unknown>,
  source = "whatsapp_button",
) {
  const now = new Date().toISOString();
  await db()
    .from("contacts")
    .update({
      consent_status: granted ? "granted" : "denied",
      consent_marketing: granted,
      consent_date: now,
      consent_source: source,
      consent_version: CONSENT_VERSION,
      consent_evidence: { ...evidence, at: now, source },
      opted_out_at: granted ? null : now,
      baseline_intake_status: granted ? "in_progress" : "not_started",
      intake_started_at: granted ? now : null,
    })
    .eq("id", contactId);
  await recordOnboardingEvent({
    contactId,
    eventType: granted ? "consent_granted" : "consent_denied",
    stage: "consent",
    payload: evidence as Record<string, unknown>,
  });
}

/**
 * Single entry point for an inbound button/quick-reply during onboarding.
 * Idempotent: replaying the same WhatsApp message id is a no-op.
 */
export async function handleOnboardingButton(args: {
  contactId: string;
  buttonId?: string | null;
  buttonTitle?: string | null;
  text?: string | null;
  sourceMessageId?: string | null;
}): Promise<{ handled: boolean; kind: string | null; reply_text: string | null; duplicate: boolean }> {
  const { parseOnboardingButton, applyOpeningReply, applyConsentReply } = await import("./two-stage");
  const button = parseOnboardingButton({
    id: args.buttonId ?? null,
    title: args.buttonTitle ?? null,
    text: args.text ?? null,
  });
  if (!button) return { handled: false, kind: null, reply_text: null, duplicate: false };

  if (args.sourceMessageId) {
    const { data: seen } = await db()
      .from("onboarding_events")
      .select("id")
      .eq("contact_id", args.contactId)
      .eq("source_message_id", args.sourceMessageId)
      .limit(1)
      .maybeSingle();
    if (seen) return { handled: true, kind: button, reply_text: null, duplicate: true };
  }

  const opening = applyOpeningReply(button);
  if (opening) {
    await setOpeningStatus(args.contactId, opening.opening_status as "available" | "deferred", {
      buttonId: args.buttonId ?? button,
      buttonTitle: args.buttonTitle ?? null,
      sourceMessageId: args.sourceMessageId ?? null,
    });
    return { handled: true, kind: button, reply_text: opening.reply_text, duplicate: false };
  }

  const consent = applyConsentReply(button);
  if (consent) {
    await setConsent(args.contactId, consent.granted, {
      button_id: args.buttonId ?? button,
      button_title: args.buttonTitle ?? null,
      source_message_id: args.sourceMessageId ?? null,
    });
    return { handled: true, kind: button, reply_text: consent.reply_text, duplicate: false };
  }
  return { handled: false, kind: null, reply_text: null, duplicate: false };
}

// ---------------------------------------------------------------- facts

export async function recordFacts(
  contactId: string,
  incoming: IncomingFact[],
): Promise<{ applied: string[]; rejected: Array<{ field_key: string; reason: string }> }> {
  const current = await loadFacts(contactId);
  const applied: string[] = [];
  const rejected: Array<{ field_key: string; reason: string }> = [];
  for (const inc of incoming) {
    const result = mergeFact(current[inc.field_key], inc);
    if (result.action === "reject") {
      rejected.push({ field_key: inc.field_key, reason: result.reason });
      continue;
    }
    if (result.action === "update") {
      await db()
        .from("contact_profile_facts")
        .update({ is_current: false })
        .eq("contact_id", contactId)
        .eq("field_key", inc.field_key)
        .eq("is_current", true);
      await db().from("contact_profile_history").insert({
        contact_id: contactId,
        field_name: inc.field_key,
        old_value: result.supersedes.value_text,
        new_value: result.fact.value_text,
        changed_by: inc.source,
        confidence_score: result.fact.confidence,
        source: result.fact.explicit_or_inferred,
      });
    }
    await db().from("contact_profile_facts").insert({
      contact_id: contactId,
      field_key: result.fact.field_key,
      value_text: result.fact.value_text,
      explicit_or_inferred: result.fact.explicit_or_inferred,
      confidence: result.fact.confidence,
      source: result.fact.source,
      source_message_id: result.fact.source_message_id,
      evidence: result.fact.evidence,
      observed_at: result.fact.observed_at,
      is_current: true,
    });
    current[inc.field_key] = result.fact;
    applied.push(inc.field_key);
  }
  return { applied, rejected };
}

// ------------------------------------------------------------ snapshot

export async function getOnboardingSnapshot(contactId: string) {
  const { data: row } = await db().from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!row) throw new Error("contact_not_found");
  const defs = await loadIntakeDefs(Number(row.intake_version ?? 1));
  const stored = await loadFacts(contactId);
  const facts = { ...factsFromContactRow(row), ...stored };
  const skipped: string[] = Array.isArray(row.intake_missing_fields) ? [] : [];
  const snap = { facts, skipped };
  const comp = completeness(defs, snap);
  const next = nextIntakeStep(defs, snap);
  return {
    routable: toRoutableContact(row),
    defs,
    facts: Object.values(facts),
    completeness: comp,
    next_step: next,
  };
}

// ------------------------------------------------- opening template gate

export async function openingTemplateState() {
  const { data: draft } = await db()
    .from("opening_templates")
    .select("*")
    .eq("template_name", OPENING_TEMPLATE_NAME)
    .maybeSingle();
  const { validateTemplateForLaunch } = await import("@/lib/whatsapp-templates.server");
  const gate = await validateTemplateForLaunch(OPENING_TEMPLATE_NAME, draft?.language_code ?? "he");
  return {
    draft: draft ?? null,
    approved: gate.ok,
    meta_status: gate.status,
    reason: gate.reason,
  };
}

// ------------------------------------------------------------- preview

export type PreviewRow = {
  input: string;
  phone: string | null;
  contact_id: string | null;
  name: string | null;
  decision: RouterResult["decision"];
  branch: RouterResult["branch"];
  reason: string;
  may_send: boolean;
  duplicate_of_input: boolean;
};

/**
 * Single source of truth for both the campaign preview screen and the actual
 * send. The send must consume exactly this output.
 */
export async function previewSendDecisions(
  rawPhones: string[],
  opts: { optInEvidence?: boolean } = {},
): Promise<{ rows: PreviewRow[]; template_approved: boolean; template_reason: string | null }> {
  const tpl = await openingTemplateState();
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];
  for (const raw of rawPhones) {
    const phone = normalizePhone(raw);
    const dup = !!phone && seen.has(phone);
    if (phone) seen.add(phone);
    const row = phone ? await findContactByPhone(phone) : null;
    const contact = row ? toRoutableContact(row) : null;
    const hasOptIn =
      opts.optInEvidence === true ||
      contact?.consent.consent_status === "granted" ||
      (!!row && Object.keys(row.consent_evidence ?? {}).length > 0);
    const decision = routeConversationStart({
      phone,
      contact,
      hasOptInEvidence: !!hasOptIn,
      openingTemplateApproved: tpl.approved,
    });
    rows.push({
      input: raw,
      phone,
      contact_id: row?.id ?? null,
      name: row?.full_name ?? row?.first_name ?? null,
      decision: dup ? "suppressed" : decision.decision,
      branch: decision.branch,
      reason: dup ? "duplicate_phone_in_batch" : decision.reason,
      may_send: dup ? false : decision.may_send,
      duplicate_of_input: dup,
    });
  }
  return { rows, template_approved: tpl.approved, template_reason: tpl.reason ?? null };
}

// -------------------------------------------------- progressive profiling

/**
 * Runs on every inbound customer message: refreshes conversation facts and
 * stores only what was clearly said, with evidence and confidence.
 */
export async function applyInboundOnboarding(args: {
  contactId: string;
  message: string;
  messageId?: string | null;
  repliedOutbound?: boolean;
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: row } = await db()
    .from("contacts")
    .select("id,total_messages,first_inbound_at,intake_last_step_id,baseline_intake_status")
    .eq("id", args.contactId)
    .maybeSingle();
  if (!row) return { applied: [], rejected: [] };

  await db()
    .from("contacts")
    .update({
      last_inbound_at: nowIso,
      first_inbound_at: row.first_inbound_at ?? nowIso,
      last_outbound_at: args.repliedOutbound ? nowIso : undefined,
      total_messages: Number(row.total_messages ?? 0) + 1 + (args.repliedOutbound ? 1 : 0),
      has_prior_conversation: true,
      service_window_open_until: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
    })
    .eq("id", args.contactId);

  const extracted = extractFieldsFromFreeText(args.message, row.intake_last_step_id ?? null);
  const incoming: IncomingFact[] = Object.entries(extracted).map(([field_key, v]) => ({
    field_key,
    value: v.value,
    kind: v.kind,
    confidence: v.confidence,
    source: "tamar_extractor",
    source_message_id: args.messageId ?? null,
    evidence: v.evidence,
    observed_at: nowIso,
  }));
  if (!incoming.length) return { applied: [], rejected: [] };
  const result = await recordFacts(args.contactId, incoming);

  // baseline completion is decided by data, never by the model
  const defs = await loadIntakeDefs();
  const facts = { ...factsFromContactRow(row), ...(await loadFacts(args.contactId)) };
  const done = nextIntakeStep(defs, { facts, skipped: [] }) === null;
  await db()
    .from("contacts")
    .update({
      baseline_intake_status: done ? "completed" : "in_progress",
      intake_completed_at: done ? nowIso : null,
      intake_started_at: row.baseline_intake_status === "not_started" ? nowIso : undefined,
    })
    .eq("id", args.contactId);
  return result;
}