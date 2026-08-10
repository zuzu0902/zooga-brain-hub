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
  ZOOGA_FALLBACK_URL,
  type IntakeFieldDefinition,
  type ProfileFact,
  type RelationshipIntakeStatus,
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
    depends_on:
      r.depends_on && typeof r.depends_on === "object" && r.depends_on.field_key
        ? { field_key: String(r.depends_on.field_key), equals: (r.depends_on.equals ?? []).map(String) }
        : null,
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
  add("city", row.residence_city ?? row.city ?? row.region);
  add("birth_date", row.birth_date);
  add("interests", row.interests);
  add("looking_for_relationship", row.looking_for_relationship);
  add("likes_travel", row.likes_travel);
  add("travel_scope", row.travel_scope);
  add("last_trip_destination", row.last_trip_destination);
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
  const { parseOnboardingButton, applyOpeningReply, applyConsentReply, applyRelationshipGateReply } =
    await import("./two-stage");
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

  const relationship = applyRelationshipGateReply(button);
  if (relationship) {
    await setRelationshipIntakeStatus(args.contactId, relationship.relationship_intake_status, {
      buttonId: args.buttonId ?? button,
      buttonTitle: args.buttonTitle ?? null,
      sourceMessageId: args.sourceMessageId ?? null,
    });
    return { handled: true, kind: button, reply_text: relationship.reply_text, duplicate: false };
  }
  return { handled: false, kind: null, reply_text: null, duplicate: false };
}

// ------------------------------------------------ relationship intake gate

/** Marks that the gate question itself was sent. Never re-asked immediately. */
export async function markRelationshipGateOffered(contactId: string) {
  const now = new Date().toISOString();
  await db()
    .from("contacts")
    .update({ relationship_intake_status: "offered", relationship_intake_offered_at: now })
    .eq("id", contactId);
  await recordOnboardingEvent({
    contactId,
    eventType: "relationship_intake_offered",
    stage: "relationship_gate",
  }).catch(() => null);
}

/**
 * "מאוחר יותר" is stored as a deferral only: it never denies consent, never
 * opts out, and never blocks normal conversation.
 */
export async function setRelationshipIntakeStatus(
  contactId: string,
  status: RelationshipIntakeStatus,
  meta: { buttonId?: string | null; buttonTitle?: string | null; sourceMessageId?: string | null } = {},
) {
  const now = new Date().toISOString();
  await db()
    .from("contacts")
    .update({
      relationship_intake_status: status,
      relationship_intake_ready_at: status === "ready_to_start" ? now : undefined,
      relationship_intake_deferred_at: status === "deferred" ? now : undefined,
    })
    .eq("id", contactId);
  await recordOnboardingEvent({
    contactId,
    eventType: status === "ready_to_start" ? "relationship_intake_yes" : "relationship_intake_later",
    stage: "relationship_gate",
    buttonId: meta.buttonId ?? null,
    buttonTitle: meta.buttonTitle ?? null,
    sourceMessageId: meta.sourceMessageId ?? null,
    payload: { is_opt_out: false, consent_touched: false },
  });
}

/**
 * Value step: one active offer with a working link, or the Zooga homepage.
 * Archived/expired offers are never surfaced.
 */
export async function pickActiveOfferLink(hints: {
  travelScope?: string | null;
  city?: string | null;
} = {}): Promise<{ offer_id: string | null; title: string | null; url: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db()
    .from("offers")
    .select("id,title,offer_url,category,status,event_date,event_end_date")
    .eq("status", "active")
    .order("event_date", { ascending: true })
    .limit(50);
  const rows = ((data as any[]) ?? []).filter(
    (o) => !!o.offer_url && (!o.event_end_date || o.event_end_date >= today) && (!o.event_date || o.event_date >= today),
  );
  if (!rows.length) return { offer_id: null, title: null, url: ZOOGA_FALLBACK_URL };
  const scope = hints.travelScope ?? null;
  const preferred =
    scope === "israel"
      ? rows.find((o) => o.category === "trip" && /ישראל|בארץ/.test(String(o.title ?? "")))
      : scope === "abroad"
        ? rows.find((o) => o.category === "trip" && !/ישראל|בארץ/.test(String(o.title ?? "")))
        : rows.find((o) => o.category === "trip");
  const chosen = preferred ?? rows[0]!;
  return { offer_id: chosen.id, title: chosen.title ?? null, url: String(chosen.offer_url) };
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
  const skipped: string[] = Array.isArray(row.intake_deferred_fields) ? row.intake_deferred_fields.map(String) : [];
  const snap = { facts, skipped };
  const comp = completeness(defs, snap);
  const next = nextIntakeStep(defs, snap);
  const { nextProgressiveStep } = await import("./baseline-intake");
  const { data: events } = await db()
    .from("onboarding_events")
    .select("event_type,stage,button_id,button_title,created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(20);
  return {
    routable: toRoutableContact(row),
    defs,
    facts: Object.values(facts),
    completeness: comp,
    next_step: next,
    next_progressive_step: nextProgressiveStep(defs, snap),
    relationship_intake: {
      status: (row.relationship_intake_status ?? "not_offered") as RelationshipIntakeStatus,
      offered_at: row.relationship_intake_offered_at ?? null,
      ready_at: row.relationship_intake_ready_at ?? null,
      deferred_at: row.relationship_intake_deferred_at ?? null,
    },
    events: (events as any[]) ?? [],
  };
}

// ------------------------------------------------------- intake turn plan

export type IntakeTurnPlan =
  | { kind: "none"; reason: string }
  | { kind: "question"; field_key: string; text: string; purpose: string | null }
  | {
      kind: "value_then_gate";
      value_text: string;
      offer_id: string | null;
      gate_text: string;
      buttons: Array<{ id: string; label: string }>;
    };

/**
 * Deterministic owner of the baseline intake turn: one unanswered question at
 * a time, then value from an ACTIVE offer (or the Zooga homepage), then the
 * relationship-questionnaire gate exactly once. Known/irrelevant fields are
 * never asked again.
 */
export async function planIntakeTurn(contactId: string): Promise<IntakeTurnPlan> {
  const { data: row } = await db().from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!row) return { kind: "none", reason: "contact_not_found" };
  if (row.consent_status !== "granted") return { kind: "none", reason: "consent_not_granted" };
  if (row.opted_out_at) return { kind: "none", reason: "opted_out" };

  const defs = await loadIntakeDefs(Number(row.intake_version ?? 1));
  const facts = { ...factsFromContactRow(row), ...(await loadFacts(contactId)) };
  const deferred: string[] = Array.isArray(row.intake_deferred_fields) ? row.intake_deferred_fields.map(String) : [];
  const snap = { facts, skipped: deferred };

  const next = nextIntakeStep(defs, snap);
  if (next) {
    await db()
      .from("contacts")
      .update({ intake_last_step_id: next.field_key, baseline_intake_status: "in_progress" })
      .eq("id", contactId);
    return { kind: "question", field_key: next.field_key, text: next.question_text, purpose: next.purpose_text ?? null };
  }

  const status = (row.relationship_intake_status ?? "not_offered") as RelationshipIntakeStatus;
  if (status !== "not_offered") return { kind: "none", reason: "baseline_and_gate_done" };

  const {
    RELATIONSHIP_INTAKE_BUTTONS,
    RELATIONSHIP_INTAKE_QUESTION_TEXT,
  } = await import("./types");
  const pick = await pickActiveOfferLink({
    travelScope: facts["travel_scope"]?.value_text ?? null,
    city: facts["city"]?.value_text ?? null,
  });
  const valueText = pick.title
    ? `תודה! הנה משהו שיכול להתאים לך: ${pick.title}\n${pick.url}`
    : `תודה! הנה כל הפעילויות המתעדכנות של זוגה:\n${pick.url}`;

  await db()
    .from("contacts")
    .update({
      baseline_intake_status: "completed",
      intake_completed_at: new Date().toISOString(),
      intake_last_step_id: null,
    })
    .eq("id", contactId);
  await markRelationshipGateOffered(contactId);

  return {
    kind: "value_then_gate",
    value_text: valueText,
    offer_id: pick.offer_id,
    gate_text: RELATIONSHIP_INTAKE_QUESTION_TEXT,
    buttons: RELATIONSHIP_INTAKE_BUTTONS.map((b) => ({ id: b.id, label: b.label })),
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
    .select("id,total_messages,first_inbound_at,intake_last_step_id,baseline_intake_status,intake_deferred_fields")
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

  const askedField: string | null = row.intake_last_step_id ?? null;
  const extracted = extractFieldsFromFreeText(args.message, askedField);

  // "לא מכיר" / "דלג" is neither an answer nor a reason to ask again: the
  // field is deferred for this conversation so intake can move forward.
  const { isDontKnowAnswer, isSkipAnswer } = await import("./baseline-intake");
  const deferred: string[] = Array.isArray(row.intake_deferred_fields) ? row.intake_deferred_fields.map(String) : [];
  if (
    askedField &&
    !extracted[askedField] &&
    (isDontKnowAnswer(args.message) || isSkipAnswer(args.message)) &&
    !deferred.includes(askedField)
  ) {
    deferred.push(askedField);
    await db().from("contacts").update({ intake_deferred_fields: deferred }).eq("id", args.contactId);
  }

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
  if (!incoming.length) return { applied: [], rejected: [], deferred };
  const result = await recordFacts(args.contactId, incoming);

  // baseline completion is decided by data, never by the model
  const defs = await loadIntakeDefs();
  const facts = { ...factsFromContactRow(row), ...(await loadFacts(args.contactId)) };
  const done = nextIntakeStep(defs, { facts, skipped: deferred }) === null;
  await db()
    .from("contacts")
    .update({
      baseline_intake_status: done ? "completed" : "in_progress",
      intake_completed_at: done ? nowIso : null,
      intake_started_at: row.baseline_intake_status === "not_started" ? nowIso : undefined,
    })
    .eq("id", args.contactId);
  return { ...result, deferred };
}