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
import { splitMetaEvents } from "@/lib/zero-loss/core";
import { ingestEvent, leaseJobForVault, finishJob, quarantineEvent } from "@/lib/zero-loss/vault.server";
import { registerIdentity } from "@/lib/zero-loss/identity.server";
import { runTamarTurn } from "@/lib/tamar-engine.server";
import { runV2Turn } from "@/lib/tamar-v2/engine.server";
import { isConsentPhase } from "@/lib/tamar-v2/engine.server";
import { v2Enabled } from "@/lib/tamar-v2/flags.server";
import { claimInbound, recordReply } from "@/lib/runtime-inbound-dedupe";
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

async function applyStatusUpdates(payload: any) {
  const statuses = parseStatusUpdates(payload);
  if (!statuses.length) return 0;
  // recipient is normalized to E.164 inside applyStatusUpdate
  for (const s of statuses) await applyStatusUpdate(s);
  return statuses.length;
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
        const leasedJobs: string[] = [];
        for (const msg of messages) {
          const vaultRef = vaultByEventId.get(msg.wamid) ?? null;
          const jobId = vaultRef && !vaultRef.duplicate ? await leaseJobForVault(vaultRef.vault_id, "webhook") : null;
          if (jobId) leasedJobs.push(jobId);
          let inboundText = msg.text;
          let inboundSource: "text" | "voice" = "text";
          let voiceConfidence: number | null = null;

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
              },
            } as any);
            results.push({ wamid: msg.wamid, duplicate: true, reply_sent: false, no_reply_reason: "duplicate_inbound" });
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
            const voiceContactId = await findContactIdByPhone(msg.from);
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
              results.push({ wamid: msg.wamid, voice: "duplicate", reply_sent: false, contact_id: voiceContactId, no_reply_reason: "duplicate_inbound" });
              continue;
            }
            if (!voice || voice.status !== "ok" || !voice.transcript) {
              const { VOICE_FAILED_TEXT } = await import("@/lib/relationship-intake/questions");
              const ack = await sendWhatsAppText(msg.from, VOICE_FAILED_TEXT);
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
            results.push({ wamid: msg.wamid, skipped: "unsupported_message_type", reply_sent: false, no_reply_reason: "unsupported_message_type" });
            continue;
          }

          // ---- Consent commands short-circuit the engine entirely ----
          if (isOptOutMessage(inboundText) || isOptInMessage(inboundText)) {
            const optOut = isOptOutMessage(inboundText);
            const contactId = await findContactIdByPhone(msg.from);
            if (optOut) await applyOptOut(msg.from, contactId);
            else await applyOptIn(msg.from, contactId);
            const confirmation = optOut ? OPT_OUT_CONFIRMATION : OPT_IN_CONFIRMATION;
            const ack = await sendWhatsAppText(msg.from, confirmation);
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

          // ---- Two-stage opening: availability button, then consent button.
          // Deterministic and idempotent; never reaches the model.
          {
            const onboardingContactId = await findContactIdByPhone(msg.from);
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
            const relContactId = await findContactIdByPhone(msg.from);
            if (relContactId) {
              const { planRelationshipTurn } = await import("@/lib/relationship-intake/intake.server");
              const plan = await planRelationshipTurn(relContactId, {
                text: inboundText,
                source: inboundSource,
                messageId: msg.wamid,
                transcriptConfidence: voiceConfidence,
              }).catch(() => null);
              if (plan && plan.kind === "messages") {
                let allOk = true;
                for (const body of plan.texts) {
                  const send = await sendWhatsAppText(msg.from, body);
                  allOk = allOk && send.ok;
                  await recordDelivery({
                    contactId: relContactId,
                    text: body,
                    result: send,
                    inboundMessageId: msg.wamid,
                    kind: plan.completed ? "relationship_intake_completed" : "relationship_intake_question",
                  });
                }
                await recordReply(msg.wamid, plan.texts.join("\n")).catch(() => {});
                results.push({
                  wamid: msg.wamid,
                  contact_id: relContactId,
                  relationship_intake: plan.question_key ?? "completed",
                  source: inboundSource,
                  reply_sent: allOk,
                });
                continue;
              }
            }
          }

          // ---- Deterministic baseline intake turn ------------------------
          // Owns the turn only while the approved intake is still running:
          // one unanswered question, then value + the relationship gate.
          {
            const intakeContactId = await findContactIdByPhone(msg.from);
            if (intakeContactId) {
              const { applyInboundOnboarding, planIntakeTurn } = await import(
                "@/lib/onboarding/onboarding.server"
              );
              await applyInboundOnboarding({
                contactId: intakeContactId,
                message: inboundText,
                messageId: msg.wamid,
              }).catch(() => null);
              const plan = await planIntakeTurn(intakeContactId).catch(() => null);
              if (plan && plan.kind !== "none") {
                if (plan.kind === "question") {
                  const send = await sendWhatsAppText(msg.from, plan.text);
                  await recordDelivery({
                    contactId: intakeContactId,
                    text: plan.text,
                    result: send,
                    inboundMessageId: msg.wamid,
                    kind: `intake_question_${plan.field_key}`,
                  });
                  await recordReply(msg.wamid, plan.text).catch(() => {});
                  results.push({ wamid: msg.wamid, contact_id: intakeContactId, intake: plan.field_key, reply_sent: send.ok });
                  continue;
                }
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
            const sentAll = v2.sends.length > 0 && v2.sends.every((s) => s.ok);
            await recordReply(msg.wamid, v2.decision.messages.map((m) => m.body).join("\n")).catch(() => {});
            results.push({
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
            results.push({
              wamid: msg.wamid,
              contact_id: turn.payload?.contact_id ?? null,
              reply_sent: false,
              error: turn.payload?.error ?? "no_reply",
              trace_id: turn.payload?.trace_id ?? null,
            });
            continue;
          }

          const send = await sendWhatsAppText(msg.from, replyText);
          await recordDelivery({
            contactId: turn.payload?.contact_id ?? null,
            offerId: turn.payload?.meta?.offer_id ?? null,
            text: replyText,
            result: send,
            inboundMessageId: msg.wamid,
          });
          await recordReply(msg.wamid, replyText).catch(() => {});

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
            provider_message_id: send.provider_message_id,
            send_error: send.error,
            handoff_requested: !!turn.payload?.handoff_requested,
          });
        }

        // Every leased job whose turn completed (any `continue` branch is a
        // completed turn too) is closed here. A thrown exception leaves the
        // lease in place so the durable worker retries it later.
        for (const jobId of leasedJobs) {
          await finishJob({ jobId, success: true, attempt: 1 }).catch(() => {});
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
