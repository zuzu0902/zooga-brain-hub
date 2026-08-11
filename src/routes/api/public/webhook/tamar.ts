/**
 * META WHATSAPP WEBHOOK — the single live entrypoint of Zooga OS.
 *
 *   Meta WhatsApp -> this route -> Tamar engine (Supabase + Lovable AI)
 *                 -> Meta Graph API send -> Supabase delivery ledger
 *
 * GET  : hub.challenge verification against META_VERIFY_TOKEN.
 * POST : X-Hub-Signature-256 HMAC verification against META_APP_SECRET.
 *        Invalid signature => 401, nothing is processed.
 *        Idempotency: runtime_inbound_dedupe keyed by Meta wamid. A retry
 *        never calls the model and never sends a second WhatsApp message.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { splitMetaEvents, classifyFailure } from "@/lib/zero-loss/core";
import { classifyTurnOutcome, isValidNoReplyReason } from "@/lib/zero-loss/turn-outcome";
import { ingestEvent, leaseJobForVault, finishJob, quarantineEvent } from "@/lib/zero-loss/vault.server";
import { registerIdentity, resolveIdentity } from "@/lib/zero-loss/identity.server";
import { runTamarTurn } from "@/lib/tamar-engine.server";
import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { isConsentPhase } from "@/lib/tamar-v2/engine.server";
import { v2Enabled } from "@/lib/tamar-v2/flags.server";
import { claimInbound, markNoReply, recordReply } from "@/lib/runtime-inbound-dedupe";
import { isOptInMessage, isOptOutMessage, OPT_IN_CONFIRMATION, OPT_OUT_CONFIRMATION } from "@/lib/optout";
import { applyOptIn, applyOptOut, applyStatusUpdate, markReplied } from "@/lib/whatsapp-status.server";
import {
  parseInboundMessages,
  parseStatusUpdates,
  recordDelivery,
  sendWhatsAppButtons,
  sendWhatsAppText,
  toE164,
  verifyHubChallenge,
  verifyMetaSignature,
} from "@/lib/whatsapp-meta.server";
import { CONSENT_QUESTION_BUTTONS, CONSENT_QUESTION_TEXT } from "@/lib/onboarding/types";
import { guardOutbound } from "@/lib/conversation-guard/guard.server";
import {
  markGateRoute,
  recordInboundMessage,
  runInboundGate,
  syncGateFacts,
} from "@/lib/inbound-gate/gate.server";
import { detectLoopSignal } from "@/lib/conversation-guard/core";
import { isUserQuestion } from "@/lib/tamar-brain/signals";
import { baselineMayOwnTurn, baselineMaySave, relationshipMayOwnTurn } from "@/lib/inbound-gate/route-policy";

async function applyStatusUpdates(payload: any) {
  const statuses = parseStatusUpdates(payload);
  if (!statuses.length) return 0;
  // recipient is normalized to E.164 inside applyStatusUpdate
  for (const s of statuses) await applyStatusUpdate(s);
  return statuses.length;
}

/** Current attempt number of a leased job (used for backoff + quarantine). */
async function jobAttempts(jobId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("processing_jobs" as any)
    .select("attempts")
    .eq("id", jobId)
    .maybeSingle();
  return Number((data as any)?.attempts ?? 1) || 1;
}

async function findContactIdByPhone(phone: string): Promise<string | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .or(`phone.eq.${e164},whatsapp_number.eq.${e164}`)
    .limit(1)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * IDEMPOTENT CONTACT RESOLUTION for one inbound turn.
 *
 * Every downstream layer (gate, onboarding, intake, engine) must see the same
 * real contact row, including a brand-new number and the create race where two
 * webhook deliveries arrive together. Resolution happens ONCE per message and
 * the result is memoized; a hard failure is thrown so the job stays retryable
 * instead of being closed as `succeeded` with silence.
 */
async function ensureContactForTurn(
  cache: { id: string | null | undefined },
  phone: string,
  displayName?: string | null,
): Promise<string | null> {
  if (cache.id !== undefined) return cache.id;
  try {
    const res = await resolveIdentity({
      phone,
      displayName: displayName ?? null,
      source: "meta_whatsapp",
      createIfMissing: true,
    });
    cache.id = res.contact_id ?? null;
  } catch (err: any) {
    // The create race: another delivery inserted the row a moment ago.
    const existing = await findContactIdByPhone(phone).catch(() => null);
    if (existing) {
      cache.id = existing;
      return existing;
    }
    throw err;
  }
  if (!cache.id) {
    const existing = await findContactIdByPhone(phone).catch(() => null);
    cache.id = existing;
  }
  return cache.id ?? null;
}

export const Route = createFileRoute("/api/public/webhook/tamar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const challenge = verifyHubChallenge(new URL(request.url));
        if (challenge) return new Response(challenge, { status: 200 });
        return new Response("forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifyMetaSignature(raw, signature)) {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "meta_whatsapp",
            status: "rejected_invalid_signature",
            error: "invalid_signature",
            payload: { signature_present: !!signature },
          } as any);
          return new Response(JSON.stringify({ error: "invalid_signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: any = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response(JSON.stringify({ error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ---- ZERO-LOSS GATE ------------------------------------------------
        // Durably persist every unit of this envelope BEFORE anything else.
        // A vault failure means Meta must retry, so we answer 5xx and do not
        // process. Anything already stored is answered 2xx as a duplicate.
        const vaultByEventId = new Map<string, { vault_id: string; correlation_id: string; duplicate: boolean }>();
        let vaultStored = 0;
        let vaultDuplicates = 0;
        const unknownShapes: string[] = [];
        try {
          for (const ev of splitMetaEvents(payload)) {
            const res = await ingestEvent(ev);
            vaultStored++;
            if (res.duplicate) vaultDuplicates++;
            if (ev.provider_event_id && ev.kind === "message") vaultByEventId.set(ev.provider_event_id, res);
            if (ev.kind === "unknown" && !res.duplicate) {
              unknownShapes.push(res.vault_id);
              await quarantineEvent({
                vaultId: res.vault_id,
                reason: "unknown_event_shape",
                severity: "warning",
                details: { event_type: ev.event_type },
              });
            }
            if (ev.phone) await registerIdentity(ev.phone, null, "meta_whatsapp").catch(() => null);
          }
        } catch (err: any) {
          // NOT acknowledged: Meta will redeliver.
          return new Response(
            JSON.stringify({ ok: false, error: "vault_unavailable", detail: String(err?.message ?? err).slice(0, 200) }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const statusCount = await applyStatusUpdates(payload);
        const messages = parseInboundMessages(payload);
        if (!messages.length) {
          return Response.json({
            ok: true,
            processed: 0,
            statuses: statusCount,
            vault: { stored: vaultStored, duplicates: vaultDuplicates, quarantined: unknownShapes.length },
          });
        }

        const results: any[] = [];
        const jobByWamid = new Map<string, { jobId: string; vaultId: string; attempt: number }>();
        for (const msg of messages) {
          const vaultRef = vaultByEventId.get(msg.wamid) ?? null;
          const jobId = vaultRef && !vaultRef.duplicate ? await leaseJobForVault(vaultRef.vault_id, "webhook") : null;
          if (jobId && vaultRef) jobByWamid.set(msg.wamid, { jobId, vaultId: vaultRef.vault_id, attempt: await jobAttempts(jobId) });
          const contactCache: { id: string | null | undefined } = { id: undefined };
          let inboundText = msg.text;
          let inboundSource: "text" | "voice" = "text";
          let voiceConfidence: number | null = null;

          try {
          // ---- Idempotency gate (wamid) BEFORE any model call or send ----
          const claim = await claimInbound({
            inboundMessageId: msg.wamid,
            phone: msg.from,
            source: "meta_whatsapp",
          });
          if (claim.duplicate) {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "meta_whatsapp",
              status: "duplicate_inbound_suppressed",
              payload: {
                inbound_message_id: msg.wamid,
                duplicate_detected: true,
                reply_sent: false,
                hit_count: claim.hit_count,
                state: claim.state,
              },
            } as any);
            // An incomplete duplicate is NOT a completed turn: it must never
            // close the job as succeeded.
            const dupComplete = claim.state === "completed";
            results.push({
              wamid: msg.wamid,
              duplicate: true,
              reply_sent: false,
              contact_id: claim.contact_id ?? null,
              ...(dupComplete
                ? { no_reply_reason: "duplicate_inbound" }
                : { error: "duplicate_incomplete" }),
            });
            continue;
          }

          await supabaseAdmin.from("webhook_logs").insert({
            source: "meta_whatsapp",
            status: "received",
            payload: {
              inbound_message_id: msg.wamid,
              from_present: !!msg.from,
              has_text: !!msg.text,
              type: msg.type,
              has_audio: !!msg.audio,
            },
          } as any);

          // ---- Inbound voice note: transcribe server-side, then continue
          // through the exact same conversational pipeline as text. ----
          if (msg.audio?.id) {
            const voiceContactId = await ensureContactForTurn(contactCache, msg.from, msg.name);
            const { transcribeInboundVoice } = await import("@/lib/voice/transcription.server");
            const voice = await transcribeInboundVoice({
              contactId: voiceContactId,
              waMessageId: msg.wamid,
              mediaId: msg.audio.id,
              mime: msg.audio.mime_type,
              phoneNumberId: msg.business_phone_number_id,
              durationSeconds: msg.audio.duration,
            }).catch(() => null);
            if (voice?.status === "duplicate") {
              await markNoReply(msg.wamid, "duplicate_inbound").catch(() => {});
              results.push({ wamid: msg.wamid, voice: "duplicate", reply_sent: false, contact_id: voiceContactId, no_reply_reason: "duplicate_inbound" });
              continue;
            }
            if (!voice || voice.status !== "ok" || !voice.transcript) {
              const { VOICE_FAILED_TEXT } = await import("@/lib/relationship-intake/questions");
              const voiceGuard = await guardOutbound({
                contactId: voiceContactId,
                phone: msg.from,
                route: "voice_failed_ack",
                inboundMessageId: msg.wamid,
                candidateText: VOICE_FAILED_TEXT,
                mode: "log_only",
              });
              const ack = await sendWhatsAppText(msg.from, voiceGuard.text);
              await recordDelivery({
                contactId: voiceContactId,
                text: VOICE_FAILED_TEXT,
                result: ack,
                inboundMessageId: msg.wamid,
                kind: "voice_transcription_failed",
              });
              await recordReply(msg.wamid, VOICE_FAILED_TEXT).catch(() => {});
              results.push({ wamid: msg.wamid, voice: "failed", contact_id: voiceContactId, reply_sent: ack.ok });
              continue;
            }
            inboundText = voice.transcript;
            inboundSource = "voice";
            voiceConfidence = voice.confidence;
          }

          if (!inboundText) {
            await markNoReply(msg.wamid, "unsupported_message_type").catch(() => {});
            results.push({ wamid: msg.wamid, skipped: "unsupported_message_type", reply_sent: false, no_reply_reason: "unsupported_message_type" });
            continue;
          }

          // ---- INBOUND CONTEXT GATE ------------------------------------
          // Exactly one classification per wamid, before intake /
          // relationship_intake / brain / campaign reply may act. Text,
          // button and voice transcript all pass through here.
          // Contact-first: gate, intake and engine all act on a real row.
          const gateContactId = await ensureContactForTurn(contactCache, msg.from, msg.name);
          const gated = await runInboundGate({
            contactId: gateContactId,
            phone: msg.from,
            inboundMessageId: msg.wamid,
            text: inboundText,
            sourceType: msg.option_id ? "button" : inboundSource === "voice" ? "voice" : "text",
            optionId: msg.option_id ?? null,
            transcriptConfidence: voiceConfidence,
          });
          const cls = gated.classification;
          await recordInboundMessage({
            contactId: gateContactId,
            text: inboundText,
            sourceType: cls.source_type,
            classification: cls,
            inboundMessageId: msg.wamid,
          });
          // Canonical facts are saved even when the message is not an answer,
          // and never overwrite information we already trust.
          if (Object.keys(cls.extracted_facts).length) {
            await syncGateFacts(gateContactId, cls.extracted_facts).catch(() => null);
          }
          const guardMeta = {
            classification: cls.kind,
            classificationConfidence: cls.confidence,
            sourceType: cls.source_type,
            extractedFacts: cls.extracted_facts,
            gateApplied: true,
          };

          // ---- Consent commands short-circuit the engine entirely ----
          if (isOptOutMessage(inboundText) || isOptInMessage(inboundText)) {
            const optOut = isOptOutMessage(inboundText);
            const contactId = await ensureContactForTurn(contactCache, msg.from, msg.name);
            if (optOut) await applyOptOut(msg.from, contactId);
            else await applyOptIn(msg.from, contactId);
            const confirmation = optOut ? OPT_OUT_CONFIRMATION : OPT_IN_CONFIRMATION;
            // Compliance acknowledgement: recorded for loop telemetry, never rewritten.
            const consentGuard = await guardOutbound({
              contactId,
              phone: msg.from,
              route: optOut ? "consent_opt_out_ack" : "consent_opt_in_ack",
              inboundMessageId: msg.wamid,
              inboundText,
              candidateText: confirmation,
              mode: "log_only",
              ...guardMeta,
            });
            const ack = await sendWhatsAppText(msg.from, consentGuard.text);
            await recordDelivery({
              contactId,
              text: confirmation,
              result: ack,
              inboundMessageId: msg.wamid,
              kind: optOut ? "opt_out_ack" : "opt_in_ack",
            });
            await recordReply(msg.wamid, confirmation).catch(() => {});
            results.push({ wamid: msg.wamid, contact_id: contactId, consent_command: optOut ? "opt_out" : "opt_in", reply_sent: ack.ok });
            continue;
          }

          // ---- Consent-opening answer (zooga_opening_consent) --------------
          // Fires only while the consent question is open. Idempotent, one
          // reply at most, never loops.
          {
            const consentContactId = contactCache.id ?? null;
            if (consentContactId) {
              const { applyConsentAnswer } = await import("@/lib/whatsapp-optin/optin.server");
              const res = await applyConsentAnswer({
                contactId: consentContactId,
                buttonId: msg.option_id ?? null,
                buttonTitle: inboundText ?? null,
                text: inboundText ?? null,
                sourceMessageId: msg.wamid,
              }).catch(() => null);
              if (res?.handled) {
                if (res.duplicate || !res.reply_text) {
                  await markNoReply(msg.wamid, "consent_opening_duplicate").catch(() => {});
                  results.push({ wamid: msg.wamid, contact_id: consentContactId, consent_opening: res.answer, duplicate: true, reply_sent: false, no_reply_reason: "consent_opening_duplicate" });
                  continue;
                }
                await guardOutbound({
                  contactId: consentContactId,
                  phone: msg.from,
                  route: `consent_opening_${res.answer}`,
                  inboundMessageId: msg.wamid,
                  inboundText,
                  candidateText: res.reply_text,
                  mode: "log_only",
                  progress: { advanced_state: true },
                }).catch(() => null);
                const send = await sendWhatsAppText(msg.from, res.reply_text);
                await recordDelivery({
                  contactId: consentContactId,
                  text: res.reply_text,
                  result: send,
                  inboundMessageId: msg.wamid,
                  kind: `consent_opening_${res.answer}`,
                });
                await recordReply(msg.wamid, res.reply_text).catch(() => {});
                results.push({ wamid: msg.wamid, contact_id: consentContactId, consent_opening: res.answer, reply_sent: !!send.ok });
                continue;
              }
            }
          }

          // ---- Two-stage opening: availability button, then consent button.
          // Deterministic and idempotent; never reaches the model.
          {
            const onboardingContactId = contactCache.id ?? null;
            if (onboardingContactId) {
              const { handleOnboardingButton } = await import("@/lib/onboarding/onboarding.server");
              const res = await handleOnboardingButton({
                contactId: onboardingContactId,
                buttonId: msg.option_id ?? null,
                buttonTitle: inboundText ?? null,
                text: inboundText ?? null,
                sourceMessageId: msg.wamid,
              }).catch(() => null);
              if (res?.handled) {
                if (res.duplicate) {
                  await markNoReply(msg.wamid, "onboarding_duplicate").catch(() => {});
                  results.push({ wamid: msg.wamid, contact_id: onboardingContactId, onboarding: res.kind, duplicate: true, reply_sent: false, no_reply_reason: "onboarding_duplicate" });
                  continue;
                }
                // availability=yes -> ask consent (interactive); otherwise ack text
                const send =
                  res.kind === "opening_available_yes"
                    ? await sendWhatsAppButtons(msg.from, CONSENT_QUESTION_TEXT, CONSENT_QUESTION_BUTTONS.map((b) => ({ id: b.id, label: b.label })))
                    : res.reply_text
                      ? await sendWhatsAppText(msg.from, res.reply_text)
                      : null;
                const bodySent =
                  res.kind === "opening_available_yes" ? CONSENT_QUESTION_TEXT : (res.reply_text ?? "");
                // Consent/availability copy is fixed by policy -> log_only.
                if (bodySent) {
                  await guardOutbound({
                    contactId: onboardingContactId,
                    phone: msg.from,
                    route: `onboarding_${res.kind}`,
                    inboundMessageId: msg.wamid,
                    inboundText,
                    candidateText: bodySent,
                    mode: "log_only",
                    progress: { advanced_state: true },
                  }).catch(() => null);
                }
                if (send) {
                  await recordDelivery({
                    contactId: onboardingContactId,
                    text: bodySent,
                    result: send,
                    inboundMessageId: msg.wamid,
                    kind: `onboarding_${res.kind}`,
                  });
                  await recordReply(msg.wamid, bodySent).catch(() => {});
                }
                if (res.kind !== "consent_yes") {
                  results.push({
                    wamid: msg.wamid,
                    contact_id: onboardingContactId,
                    onboarding: res.kind,
                    reply_sent: !!send?.ok,
                  });
                  continue;
                }
                // consent granted: fall through so the engine starts baseline intake
              }
            }
          }

          // ---- Relationship questionnaire ------------------------------
          // Owns the turn from relationship_intake_status = ready_to_start
          // until the completion message was sent. Free text and voice only,
          // one question per turn, no human-agent offer.
          {
            const relContactId = contactCache.id ?? null;
            // question / confusion / topic_shift / multi_intent skip the
            // questionnaire entirely and are answered by Tamar v2.
            if (relContactId && relationshipMayOwnTurn(cls)) {
              const { planRelationshipTurn } = await import("@/lib/relationship-intake/intake.server");
              const plan = await planRelationshipTurn(relContactId, {
                text: inboundText,
                source: inboundSource,
                messageId: msg.wamid,
                transcriptConfidence: voiceConfidence,
                gate: {
                  kind: cls.kind,
                  answer_valid: cls.answer_valid,
                  should_advance: cls.should_advance,
                },
              }).catch(() => null);
              if (plan && plan.kind === "messages") {
                // ONE customer-visible message per turn: intro/value lines and
                // the question are merged so nothing reaches the customer
                // outside guard + ledger, and a retry cannot re-send a part.
                const merged = plan.texts.filter(Boolean).join("\n\n");
                const relGuard = await guardOutbound({
                  contactId: relContactId,
                  phone: msg.from,
                  route: "relationship_intake",
                  inboundMessageId: msg.wamid,
                  inboundText,
                  candidateText: merged,
                  askedField: plan.question_key ?? null,
                  progress: { advanced_state: true, saved_new_fact: true },
                  ...guardMeta,
                });
                await markGateRoute(msg.wamid, "relationship_intake");
                const relBody = relGuard.verdict === "send" ? merged : relGuard.text;
                const send = await sendWhatsAppText(msg.from, relBody);
                await recordDelivery({
                  contactId: relContactId,
                  text: relBody,
                  result: send,
                  inboundMessageId: msg.wamid,
                  kind: plan.completed ? "relationship_intake_completed" : "relationship_intake_question",
                });
                await recordReply(msg.wamid, relBody).catch(() => {});
                results.push({
                  wamid: msg.wamid,
                  contact_id: relContactId,
                  relationship_intake: plan.question_key ?? "completed",
                  source: inboundSource,
                  guard: relGuard.verdict,
                  reply_sent: send.ok,
                });
                continue;
              }
            }
          }

          // ---- Deterministic baseline intake turn ------------------------
          // Owns the turn only while the approved intake is still running:
          // one unanswered question, then value + the relationship gate.
          // It NEVER owns a turn where the customer asked a direct question or
          // signalled a loop — answering the customer always comes first.
          {
            const intakeContactId = contactCache.id ?? null;
            const intakeMayOwnTurn = baselineMayOwnTurn({
              cls,
              looksLikeQuestion: isUserQuestion(inboundText),
              loopSignal: detectLoopSignal(inboundText),
            });
            if (intakeContactId && intakeMayOwnTurn) {
              const { applyInboundOnboarding, planIntakeTurn } = await import(
                "@/lib/onboarding/onboarding.server"
              );
              // Only a gate-validated answer may be captured / advance state.
              const applied = baselineMaySave(cls)
                ? await applyInboundOnboarding({
                    contactId: intakeContactId,
                    message: inboundText,
                    messageId: msg.wamid,
                  }).catch(() => null)
                : null;
              // A null / throwing intake plan must NEVER swallow the turn: it
              // falls through to Tamar v2 (and then to the guarded fallback).
              const plan = await planIntakeTurn(intakeContactId).catch(async (err: any) => {
                await supabaseAdmin
                  .from("webhook_logs")
                  .insert({
                    source: "baseline_intake",
                    status: "intake_plan_failed_fallthrough",
                    error: String(err?.message ?? err).slice(0, 300),
                    payload: { inbound_message_id: msg.wamid, contact_id: intakeContactId },
                  } as any);
                return null;
              });
              if (plan && plan.kind !== "none") {
                if (plan.kind === "question") {
                  // ---- Conversation Progress Guard -----------------------
                  const guard = await guardOutbound({
                    contactId: intakeContactId,
                    phone: msg.from,
                    route: "baseline_intake",
                    inboundMessageId: msg.wamid,
                    inboundText,
                    candidateText: plan.text,
                    ...guardMeta,
                    askedField: plan.field_key,
                    purpose: plan.purpose,
                    progress: { saved_new_fact: !!applied?.applied?.length },
                  });
                  await markGateRoute(msg.wamid, "baseline_intake");
                  const send = await sendWhatsAppText(msg.from, guard.text);
                  await recordDelivery({
                    contactId: intakeContactId,
                    text: guard.text,
                    result: send,
                    inboundMessageId: msg.wamid,
                    kind: `intake_${guard.verdict}_${plan.field_key}`,
                  });
                  // A guarded question is never asked a third time: after a
                  // recovery the field is deferred for this conversation.
                  if (guard.verdict === "recovery") {
                    const { data: c } = await supabaseAdmin
                      .from("contacts")
                      .select("intake_deferred_fields")
                      .eq("id", intakeContactId)
                      .maybeSingle();
                    const cur: string[] = Array.isArray((c as any)?.intake_deferred_fields)
                      ? (c as any).intake_deferred_fields.map(String)
                      : [];
                    if (!cur.includes(plan.field_key)) {
                      await supabaseAdmin
                        .from("contacts")
                        .update({ intake_deferred_fields: [...cur, plan.field_key] } as any)
                        .eq("id", intakeContactId);
                    }
                  }
                  await recordReply(msg.wamid, guard.text).catch(() => {});
                  results.push({
                    wamid: msg.wamid,
                    contact_id: intakeContactId,
                    intake: plan.field_key,
                    guard: guard.verdict,
                    guard_reason: guard.reason,
                    reply_sent: send.ok,
                  });
                  continue;
                }
                const gateGuard = await guardOutbound({
                  contactId: intakeContactId,
                  phone: msg.from,
                  route: "intake_value_gate",
                  inboundMessageId: msg.wamid,
                  inboundText,
                  candidateText: plan.gate_text,
                  askedField: "relationship_gate",
                  progress: { advanced_state: true, provided_requested_info: true },
                  ...guardMeta,
                });
                const valueSend = await sendWhatsAppText(msg.from, plan.value_text);
                await recordDelivery({
                  contactId: intakeContactId,
                  offerId: plan.offer_id,
                  text: plan.value_text,
                  result: valueSend,
                  inboundMessageId: msg.wamid,
                  kind: "intake_value",
                });
                const gateSend = await sendWhatsAppButtons(msg.from, plan.gate_text, plan.buttons);
                await recordDelivery({
                  contactId: intakeContactId,
                  text: plan.gate_text,
                  result: gateSend,
                  inboundMessageId: msg.wamid,
                  kind: "relationship_intake_gate",
                });
                await recordReply(msg.wamid, `${plan.value_text}\n${plan.gate_text}`).catch(() => {});
                results.push({
                  wamid: msg.wamid,
                  contact_id: intakeContactId,
                  intake: "value_then_relationship_gate",
                  guard: gateGuard.verdict,
                  reply_sent: valueSend.ok && gateSend.ok,
                });
                continue;
              }
            }
          }

          // ---- Tamar Brain V2 ----
          // The consent phase (exact opener + yes/no buttons) is always owned
          // by v2, even while the flag is off for the rest of the flow.
          const flag = await v2Enabled(msg.from);
          const consentPhase = flag.enabled ? false : await isConsentPhase({ phone: msg.from }).catch(() => false);
          if (flag.enabled || consentPhase) {
            const v2 = await runV2Turn({
              phone: msg.from,
              message: inboundText,
              option_id: msg.option_id,
              name: msg.name,
              inbound_message_id: msg.wamid,
              source: "meta_webhook",
            });
            await markReplied(msg.from, v2.contact_id).catch(() => {});
            await markGateRoute(msg.wamid, "tamar_v2");
            const sentAll = v2.sends.length > 0 && v2.sends.every((s) => s.ok);
            if (sentAll) {
              await recordReply(msg.wamid, v2.decision.messages.map((m) => m.body).join("\n")).catch(() => {});
            } else if (isValidNoReplyReason(v2.no_reply_reason)) {
              await markNoReply(msg.wamid, String(v2.no_reply_reason)).catch(() => {});
            }
            // No send AND no documented reason => never silence: exactly one
            // guarded recovery message, and the job stays retryable.
            let v2Fallback: any = null;
            if (!sentAll && !isValidNoReplyReason(v2.no_reply_reason)) {
              const { maybeSendRecoveryFallback } = await import("@/lib/conversation-guard/fallback.server");
              v2Fallback = await maybeSendRecoveryFallback({
                contactId: v2.contact_id ?? contactCache.id ?? null,
                phone: msg.from,
                inboundMessageId: msg.wamid,
                inboundText,
                error: v2.no_reply_reason ?? "v2_no_outbound",
              }).catch(() => null);
            }
            results.push({
              recovery_fallback: v2Fallback?.sent ?? undefined,
              recovery_reason: v2Fallback?.reason ?? undefined,
              wamid: msg.wamid,
              engine: flag.enabled ? "v2" : "v2_consent_phase",
              contact_id: v2.contact_id,
              state: v2.decision.next_state,
              reply_sent: sentAll,
              no_reply_reason: v2.no_reply_reason,
              silent: v2.decision.silent,
              reason_codes: v2.decision.reason_codes,
              send_errors: v2.sends.filter((s) => !s.ok).map((s) => s.error),
            });
            continue;
          }

          const turn = await runTamarTurn({
            message: inboundText,
            phone: msg.from,
            whatsapp_number: msg.from,
            name: msg.name,
            source: "whatsapp",
            meta_message_id: msg.wamid,
            meta_timestamp: msg.timestamp,
          });

          // inbound = the lead replied; reconcile lead + campaign membership
          await markReplied(msg.from, turn.payload?.contact_id ?? null).catch(() => {});

          const replyText: string = turn.payload?.reply_text ?? "";
          // Brain gate may deliberately suppress automation (human_owned,
          // frozen thread, already-clarified ambiguous consent).
          if (turn.payload?.suppressed) {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "tamar_brain",
              status: "suppressed_no_reply",
              payload: {
                inbound_message_id: msg.wamid,
                brain_state: turn.payload?.brain_state ?? null,
                brain_reason: turn.payload?.brain_reason ?? null,
              },
            } as any);
            await markNoReply(msg.wamid, "suppressed_brain_gate").catch(() => {});
            results.push({
              wamid: msg.wamid,
              contact_id: turn.payload?.contact_id ?? null,
              reply_sent: false,
              suppressed: true,
              no_reply_reason: "suppressed_brain_gate",
              brain_state: turn.payload?.brain_state ?? null,
            });
            continue;
          }
          if (turn.status !== 200 || !replyText) {
            // Decision layer failed while vault + DB are healthy: never leave
            // the customer in silence. Exactly one recovery fallback is sent
            // (idempotent through the guard); the job stays retryable so the
            // real answer can still be repaired internally.
            const failure = turn.payload?.error ?? "no_reply";
            const { maybeSendRecoveryFallback } = await import("@/lib/conversation-guard/fallback.server");
            const fb = await maybeSendRecoveryFallback({
              contactId: turn.payload?.contact_id ?? null,
              phone: msg.from,
              inboundMessageId: msg.wamid,
              inboundText,
              error: failure,
            }).catch(() => null);
            results.push({
              wamid: msg.wamid,
              contact_id: turn.payload?.contact_id ?? null,
              reply_sent: false,
              error: failure,
              recovery_fallback: fb?.sent ?? false,
              recovery_reason: fb?.reason ?? null,
              trace_id: turn.payload?.trace_id ?? null,
            });
            continue;
          }

          // ---- Conversation Progress Guard (engine path) ----------------
          const engineGuard = await guardOutbound({
            contactId: turn.payload?.contact_id ?? null,
            phone: msg.from,
            route: "tamar_engine",
            inboundMessageId: msg.wamid,
            inboundText,
            candidateText: replyText,
            intent: turn.payload?.meta?.intent ?? null,
            stateBefore: turn.payload?.brain_state ?? null,
            progress: {
              answered_user_intent: !!turn.payload?.meta?.answered,
              provided_requested_info: !!turn.payload?.meta?.offer_id,
              performed_handoff: !!turn.payload?.handoff_requested,
            },
          });
          const outboundText = engineGuard.text;
          const send = await sendWhatsAppText(msg.from, outboundText);
          await recordDelivery({
            contactId: turn.payload?.contact_id ?? null,
            offerId: turn.payload?.meta?.offer_id ?? null,
            text: outboundText,
            result: send,
            inboundMessageId: msg.wamid,
          });
          await recordReply(msg.wamid, outboundText).catch(() => {});

          if (turn.payload?.trace_id) {
            await supabaseAdmin
              .from("tamar_runtime_executions" as any)
              .update({
                raw_payload: {
                  ...(turn.payload?.raw_payload ?? {}),
                  delivery: {
                    transport: "meta_direct",
                    ok: send.ok,
                    provider_message_id: send.provider_message_id,
                    http_status: send.status,
                    error: send.error,
                  },
                },
              } as any)
              .eq("id", turn.payload.trace_id);
          }

          results.push({
            wamid: msg.wamid,
            contact_id: turn.payload?.contact_id ?? null,
            trace_id: turn.payload?.trace_id ?? null,
            reply_sent: send.ok,
            guard: engineGuard.verdict,
            guard_reason: engineGuard.reason,
            provider_message_id: send.provider_message_id,
            send_error: send.error,
            handoff_requested: !!turn.payload?.handoff_requested,
          });
          } catch (err: any) {
            // A classified processing failure. The failure is durably logged
            // BEFORE any recovery attempt, so a crash inside the fallback
            // still leaves a trace. The job below is closed as retryable.
            await supabaseAdmin
              .from("webhook_logs")
              .insert({
                source: "meta_whatsapp",
                status: "turn_failed",
                error: String(err?.message ?? err).slice(0, 300),
                payload: {
                  inbound_message_id: msg.wamid,
                  contact_id: contactCache.id ?? null,
                  stage: "reply_pipeline",
                },
              } as any);
            const { maybeSendRecoveryFallback } = await import("@/lib/conversation-guard/fallback.server");
            const fb = await maybeSendRecoveryFallback({
              contactId: contactCache.id ?? (await findContactIdByPhone(msg.from).catch(() => null)),
              phone: msg.from,
              inboundMessageId: msg.wamid,
              inboundText,
              error: err,
            }).catch(() => null);
            results.push({
              wamid: msg.wamid,
              reply_sent: false,
              error: String(err?.code ?? err?.message ?? err).slice(0, 200),
              recovery_fallback: fb?.sent ?? false,
              recovery_reason: fb?.reason ?? null,
              correlation_id: err?.correlation_id ?? null,
            });
          }
        }

        // A job only reaches `succeeded` when the required business result
        // happened: a real contact_id AND an outbound send, or an explicit,
        // documented no-reply reason. Anything else is retryable, and after
        // max attempts it is quarantined for human review.
        for (const r of results) {
          const job = jobByWamid.get(r.wamid);
          if (!job) continue;
          const outcome = classifyTurnOutcome({
            contactId: r.contact_id ?? null,
            sends: r.reply_sent === true ? [{ ok: true }] : r.reply_sent === false ? [{ ok: false }] : [],
            noReplyReason: r.no_reply_reason ?? null,
            error: r.error ?? null,
            attempt: job.attempt,
          });
          r.job_outcome = outcome.reason;
          if (outcome.success) {
            await finishJob({ jobId: job.jobId, success: true, attempt: job.attempt, contactId: r.contact_id ?? null }).catch(() => {});
            continue;
          }
          await finishJob({ jobId: job.jobId, success: false, error: outcome.reason, attempt: job.attempt }).catch(() => {});
          if (outcome.quarantine) {
            await quarantineEvent({
              vaultId: job.vaultId,
              jobId: job.jobId,
              reason: classifyFailure(outcome.reason),
              severity: "critical",
              details: { inbound_message_id: r.wamid, outcome: outcome.reason, attempt: job.attempt },
            }).catch(() => {});
          }
        }

        return Response.json({
          ok: true,
          processed: results.length,
          statuses: statusCount,
          vault: { stored: vaultStored, duplicates: vaultDuplicates, quarantined: unknownShapes.length },
          results,
        });
      },
    },
  },
});
