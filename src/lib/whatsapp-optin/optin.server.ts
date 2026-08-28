/**
 * Consent-opening route (server-only).
 *
 * Sends the approved Meta template `zooga_opening_consent` (he) exactly once
 * to contacts whose WhatsApp opt-in is `verified`. Marketing consent is NOT
 * required here — it is what this message asks for.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendWhatsAppTemplate,
  sendWhatsAppText,
  recordDelivery,
  isSessionWindowOpen,
} from "@/lib/whatsapp-meta.server";
import { quiet } from "@/lib/db-safe";
import {
  CONSENT_OPENING_LANGUAGE,
  CONSENT_OPENING_TEMPLATE,
  CONSENT_NO_REPLY,
  CONSENT_YES_REPLY,
  consentOpeningText,
  classifyConsentReply,
  consentAskEvidence,
  consentResponseEvidence,
  CONSENT_WORDING_VERSION,
  evaluateConsentOpening,
  type OptInStatus,
} from "./core";

export type OpeningOutcome = {
  contact_id: string;
  status: "sent" | "skipped" | "failed";
  reason: string | null;
  reason_he: string | null;
  transport: "template" | "session" | null;
  provider_message_id: string | null;
  opening_status: string;
  dry_run: boolean;
};

async function log(status: string, payload: Record<string, unknown>) {
  await quiet(
    supabaseAdmin.from("webhook_logs").insert({
      source: "consent_opening",
      status,
      payload: payload as any,
    } as any),
  );
}

/** Send the consent opening once. Never sends twice for the same contact. */
export async function sendConsentOpening(
  contactId: string,
  opts: { dryRun?: boolean } = {},
): Promise<OpeningOutcome> {
  const dryRun = !!opts.dryRun;
  const base: OpeningOutcome = {
    contact_id: contactId,
    status: "skipped",
    reason: null,
    reason_he: null,
    transport: null,
    provider_message_id: null,
    opening_status: "not_sent",
    dry_run: dryRun,
  };

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, phone, whatsapp_number, first_name, full_name, consent_marketing, opted_out_at, human_owned, opening_status, whatsapp_opt_in_status, whatsapp_opt_in_at, whatsapp_opt_in_source, pilot_eligible_at, last_inbound_at",
    )
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) {
    await log("skipped", { contact_id: contactId, reason: "contact_not_found" });
    return { ...base, reason: "contact_not_found", reason_he: "איש הקשר לא נמצא" };
  }

  const c = contact as any;
  base.opening_status = String(c.opening_status ?? "not_sent");

  const gate = evaluateConsentOpening(c);
  if (!gate.allowed) {
    await log("skipped", { contact_id: contactId, reason: gate.reason });
    return { ...base, reason: gate.reason, reason_he: gate.reason_he };
  }

  const to = String(c.whatsapp_number || c.phone);
  const firstName = c.first_name || String(c.full_name ?? "").split(" ")[0] || "";

  // Prefer the existing service window when one is open (cheaper, free-form).
  const sessionOpen = await isSessionWindowOpen(contactId);
  const transport: "template" | "session" = sessionOpen ? "session" : "template";

  if (dryRun) {
    await log("dry_run", { contact_id: contactId, transport, basis: gate.basis });
    return { ...base, status: "sent", transport, provider_message_id: "dryrun" };
  }

  // LAST GATE before any real network call: the canonical live allowlist.
  const { assertLiveSendAllowed } = await import("@/lib/tamar-pilot/live-allowlist.server");
  const allowlist = await assertLiveSendAllowed({ phone: to, contactId, kind: "consent_opening" });
  if (!allowlist.allowed) {
    await log("skipped", { contact_id: contactId, reason: allowlist.reason });
    return { ...base, reason: allowlist.reason, reason_he: allowlist.reason_he };
  }

  // Idempotency: claim the opening slot BEFORE the network call.
  const { data: claimed } = await supabaseAdmin
    .from("contacts")
    .update({ opening_status: "sending" } as any)
    .eq("id", contactId)
    .eq("opening_status", base.opening_status)
    .select("id");
  if (!claimed?.length) {
    return { ...base, reason: "opening_already_sent", reason_he: "הודעת הפתיחה כבר נשלחה" };
  }

  const text = consentOpeningText(firstName);
  const res =
    transport === "session"
      ? await sendWhatsAppText(to, text)
      : await sendWhatsAppTemplate(to, CONSENT_OPENING_TEMPLATE, CONSENT_OPENING_LANGUAGE, [
          { type: "body", parameters: [{ type: "text", text: firstName || "שלום" }] },
        ]);

  await recordDelivery({ contactId, text, result: res as any, kind: "consent_opening" });

  if (!res.ok) {
    await supabaseAdmin
      .from("contacts")
      .update({ opening_status: base.opening_status } as any)
      .eq("id", contactId);
    await log("failed", { contact_id: contactId, transport, error: String(res.error ?? "").slice(0, 300) });
    return {
      ...base,
      status: "failed",
      transport,
      reason: String(res.error ?? "send_failed").slice(0, 300),
      reason_he: "השליחה נכשלה",
    };
  }

  const now = new Date().toISOString();
  const ask = consentAskEvidence({
    transport,
    text,
    providerMessageId: res.provider_message_id ?? null,
    basis: gate.basis ?? null,
    askedAt: now,
  });
  await supabaseAdmin
    .from("contacts")
    .update({
      opening_status: "asked",
      opening_asked_at: now,
      consent_asked_at: now,
      consent_status: "asked",
      consent_wording_version: CONSENT_WORDING_VERSION,
      consent_version: CONSENT_WORDING_VERSION,
      consent_source: "whatsapp_consent_opening",
      consent_message_id: res.provider_message_id ?? null,
      consent_evidence: { ask } as any,
    } as any)
    .eq("id", contactId);
  await log("sent", { contact_id: contactId, transport, provider_message_id: res.provider_message_id });

  return {
    ...base,
    status: "sent",
    transport,
    provider_message_id: res.provider_message_id ?? null,
    opening_status: "asked",
  };
}


/** Manual opt-in maintenance from the admin UI. verified requires a source. */
export async function setWhatsAppOptIn(args: {
  contactId: string;
  status: OptInStatus;
  source?: string | null;
  evidence?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (args.status === "verified" && !String(args.source ?? "").trim()) {
    return { ok: false, error: "אישור מאומת מחייב ציון מקור" };
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    whatsapp_opt_in_status: args.status,
    whatsapp_opt_in_source: args.status === "unknown" ? null : args.source ?? null,
    whatsapp_opt_in_evidence: args.status === "unknown" ? null : args.evidence ?? null,
    whatsapp_opt_in_at: args.status === "unknown" ? null : now,
  };
  if (args.status === "denied") {
    patch.consent_marketing = false;
    patch.opted_out_at = now;
  }
  const { error } = await supabaseAdmin.from("contacts").update(patch as any).eq("id", args.contactId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export type ConsentAnswerResult = {
  handled: boolean;
  answer: "yes" | "no" | null;
  reply_text: string | null;
  duplicate: boolean;
};

/**
 * Apply a yes/no answer to the consent opening. Idempotent: once the contact
 * has answered, a repeat answer sends nothing (no loops).
 */
export async function applyConsentAnswer(args: {
  contactId: string;
  buttonId?: string | null;
  buttonTitle?: string | null;
  text?: string | null;
  sourceMessageId?: string | null;
}): Promise<ConsentAnswerResult> {
  const answer = classifyConsentReply(args);
  if (!answer) return { handled: false, answer: null, reply_text: null, duplicate: false };

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, opening_status, consent_marketing, opted_out_at, whatsapp_opt_in_status, consent_evidence, consent_asked_at, consent_message_id, consent_wording_version",
    )
    .eq("id", args.contactId)
    .maybeSingle();
  if (!contact) return { handled: false, answer, reply_text: null, duplicate: false };

  const c = contact as any;
  // Only meaningful while the consent question is open.
  if (String(c.opening_status ?? "not_sent") !== "asked") {
    return { handled: false, answer, reply_text: null, duplicate: false };
  }

  const now = new Date().toISOString();
  const askedAt = String(c.consent_asked_at ?? "") || now;
  const ask =
    (c.consent_evidence as any)?.ask ??
    consentAskEvidence({
      transport: "template",
      text: "",
      providerMessageId: (c.consent_message_id as string) ?? null,
      basis: null,
      askedAt,
    });
  const response = consentResponseEvidence({
    answer,
    buttonId: args.buttonId ?? null,
    buttonTitle: args.buttonTitle ?? null,
    text: args.text ?? null,
    sourceMessageId: args.sourceMessageId ?? null,
    respondedAt: now,
  });
  const evidence = { ask, response, linked: true } as any;
  const wordingVersion = String(c.consent_wording_version ?? "") || CONSENT_WORDING_VERSION;

  if (answer === "yes") {
    const { data: updated } = await supabaseAdmin
      .from("contacts")
      .update({
        consent_marketing: true,
        consent_status: "granted",
        consent_date: now,
        consent_responded_at: now,
        consent_source: "whatsapp_reply",
        consent_wording_version: wordingVersion,
        consent_version: wordingVersion,
        consent_evidence: evidence,
        opted_out_at: null,
        whatsapp_opt_in_status: "verified",
        whatsapp_opt_in_at: now,
        whatsapp_opt_in_source: "whatsapp_reply",
        whatsapp_opt_in_evidence: String(args.sourceMessageId ?? args.text ?? "").slice(0, 300),
        opening_status: "available",
        opening_responded_at: now,
        baseline_intake_status: "in_progress",
        intake_started_at: now,
        service_window_open_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      } as any)
      .eq("id", args.contactId)
      .eq("opening_status", "asked")
      .select("id");
    if (!updated?.length) return { handled: true, answer, reply_text: null, duplicate: true };
    await log("consent_yes", { contact_id: args.contactId, source_message_id: args.sourceMessageId ?? null });
    return { handled: true, answer, reply_text: CONSENT_YES_REPLY, duplicate: false };
  }

  const { data: updated } = await supabaseAdmin
    .from("contacts")
    .update({
      consent_marketing: false,
      consent_status: "denied",
      consent_date: now,
      consent_responded_at: now,
      consent_source: "whatsapp_reply",
      consent_wording_version: wordingVersion,
      consent_version: wordingVersion,
      consent_evidence: evidence,
      opted_out_at: now,
      whatsapp_opt_in_status: "denied",
      whatsapp_opt_in_at: now,
      whatsapp_opt_in_source: "whatsapp_reply",
      whatsapp_opt_in_evidence: String(args.sourceMessageId ?? args.text ?? "").slice(0, 300),
      opening_status: "declined",
      opening_responded_at: now,
    } as any)
    .eq("id", args.contactId)
    .eq("opening_status", "asked")
    .select("id");
  if (!updated?.length) return { handled: true, answer, reply_text: null, duplicate: true };
  await log("consent_no", { contact_id: args.contactId, source_message_id: args.sourceMessageId ?? null });
  return { handled: true, answer, reply_text: CONSENT_NO_REPLY, duplicate: false };
}
