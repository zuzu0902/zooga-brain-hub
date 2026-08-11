/**
 * RELATIONSHIP QUESTIONNAIRE — server layer.
 *
 * Deterministic: one question per turn, resumable from the exact missing
 * field, answers are append-only (corrections supersede, never delete), and
 * the completion message is sent exactly once.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_RELATIONSHIP_QUESTIONS,
  RELATIONSHIP_COMPLETION_TEXT,
  RELATIONSHIP_INTRO_TEXT,
  acknowledgment,
  buildConfirmationQuestion,
  composeTurnText,
  extractRelationshipFields,
  isSkipRequest,
  isUncertainTranscript,
  needsFollowUp,
  nextRelationshipQuestion,
  readConfirmationReply,
  relationshipProgress,
  sortedQuestions,
  type AnswerSource,
  type RelationshipAnswer,
  type RelationshipQuestion,
  type RelationshipSnapshot,
} from "./questions";

const db = () => supabaseAdmin as any;

export async function loadRelationshipQuestions(): Promise<RelationshipQuestion[]> {
  const { data } = await db()
    .from("relationship_intake_questions")
    .select("*")
    .order("order_index", { ascending: true });
  const rows = (data as any[]) ?? [];
  if (!rows.length) return DEFAULT_RELATIONSHIP_QUESTIONS;
  return rows.map((r) => ({
    question_key: r.question_key,
    label: r.label,
    question_text: r.question_text,
    order_index: Number(r.order_index ?? 0),
    active: r.active !== false,
    skippable: r.skippable !== false,
    required: !!r.required,
    is_final_question: !!r.is_final_question,
  }));
}

export async function loadRelationshipConfig() {
  const { data } = await db().from("relationship_intake_config").select("*").maybeSingle();
  return {
    intro_text: data?.intro_text ?? RELATIONSHIP_INTRO_TEXT,
    completion_text: data?.completion_text ?? RELATIONSHIP_COMPLETION_TEXT,
    voice_enabled: data?.voice_enabled !== false,
    voice_rules: data?.voice_rules ?? null,
  };
}

export async function loadRelationshipAnswers(contactId: string): Promise<RelationshipSnapshot> {
  const { data } = await db()
    .from("relationship_intake_answers")
    .select("*")
    .eq("contact_id", contactId)
    .eq("is_current", true);
  const answers: Record<string, RelationshipAnswer> = {};
  for (const r of ((data as any[]) ?? [])) {
    answers[r.question_key] = {
      question_key: r.question_key,
      raw_text: r.raw_text ?? null,
      structured_value: r.structured_value ?? {},
      source: (r.source ?? "text") as AnswerSource,
      evidence_message_id: r.evidence_message_id ?? null,
      confidence: r.confidence == null ? null : Number(r.confidence),
      skipped_by_user: !!r.skipped_by_user,
      answered_at: r.answered_at ?? r.created_at,
    };
  }
  return { answers };
}

export async function loadRelationshipState(contactId: string) {
  const { data } = await db()
    .from("relationship_intake_state")
    .select("*")
    .eq("contact_id", contactId)
    .maybeSingle();
  return (
    data ?? {
      contact_id: contactId,
      status: "not_started",
      current_question_key: null,
      intro_sent_at: null,
      started_at: null,
      last_answered_at: null,
      completed_at: null,
      completion_sent_at: null,
      pending_confirmation: null,
    }
  );
}

async function upsertState(contactId: string, patch: Record<string, unknown>) {
  await db()
    .from("relationship_intake_state")
    .upsert({ contact_id: contactId, ...patch }, { onConflict: "contact_id" });
}

/**
 * Append-only write. An answer to an already-answered question supersedes the
 * previous one and is stored as a correction; history is never deleted.
 */
export async function saveRelationshipAnswer(args: {
  contactId: string;
  questionKey: string;
  rawText: string | null;
  structuredValue?: Record<string, string | number | boolean | null>;
  source: AnswerSource;
  evidenceMessageId?: string | null;
  confidence?: number | null;
  skipped?: boolean;
}): Promise<{ saved: boolean; correction: boolean }> {
  const { data: current } = await db()
    .from("relationship_intake_answers")
    .select("id")
    .eq("contact_id", args.contactId)
    .eq("question_key", args.questionKey)
    .eq("is_current", true)
    .maybeSingle();
  const correction = !!current;
  if (current) {
    await db().from("relationship_intake_answers").update({ is_current: false }).eq("id", current.id);
  }
  const { error } = await db().from("relationship_intake_answers").insert({
    contact_id: args.contactId,
    question_key: args.questionKey,
    raw_text: args.rawText,
    structured_value: args.structuredValue ?? {},
    source: args.source,
    evidence_message_id: args.evidenceMessageId ?? null,
    confidence: args.confidence ?? null,
    skipped_by_user: !!args.skipped,
    is_correction: correction,
    is_current: true,
    answered_at: new Date().toISOString(),
  });
  if (error && String(error.code) !== "23505") throw new Error(error.message);
  return { saved: !error, correction };
}

// ------------------------------------------------------------- turn plan

export type RelationshipTurnPlan =
  | { kind: "none"; reason: string }
  | { kind: "messages"; texts: string[]; completed: boolean; question_key: string | null };

export type RelationshipInbound = {
  text: string;
  source: AnswerSource;
  messageId?: string | null;
  /** provider confidence for a voice note, when the provider returns one */
  transcriptConfidence?: number | null;
  /**
   * Inbound Context Gate verdict. When the gate says this message is not an
   * answer to the current question (question / confusion / topic shift), the
   * questionnaire NEVER stores it and NEVER advances.
   */
  gate?: {
    kind: string;
    answer_valid: boolean;
    should_advance: boolean;
  } | null;
};

/**
 * Owns the turn while the questionnaire is running. Returns the exact texts
 * to send, in order. Never offers a human agent.
 */
export async function planRelationshipTurn(
  contactId: string,
  inbound: RelationshipInbound | null,
): Promise<RelationshipTurnPlan> {
  const gate = inbound?.gate ?? null;
  const gateBlocks = !!gate && !gate.should_advance;
  const gateAllowsCapture = !gate || (gate.should_advance && gate.answer_valid);
  const { data: contact } = await db()
    .from("contacts")
    .select("id,relationship_intake_status,opted_out_at,consent_status")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return { kind: "none", reason: "contact_not_found" };
  if (contact.opted_out_at) return { kind: "none", reason: "opted_out" };

  const state = await loadRelationshipState(contactId);
  const gateReady = contact.relationship_intake_status === "ready_to_start";
  if (!gateReady && state.status !== "in_progress") {
    return { kind: "none", reason: "relationship_intake_not_ready" };
  }
  if (state.status === "completed") return { kind: "none", reason: "already_completed" };

  const [questions, config] = await Promise.all([loadRelationshipQuestions(), loadRelationshipConfig()]);
  const active = sortedQuestions(questions);
  if (!active.length) return { kind: "none", reason: "no_active_questions" };

  // --- first turn: intro + first question ---------------------------------
  if (state.status !== "in_progress") {
    // The customer sets the pace: never open the questionnaire on top of a
    // question, confusion, topic shift or handoff/opt-out request.
    if (gateBlocks) return { kind: "none", reason: `inbound_${gate!.kind}` };
    const snapshot = await loadRelationshipAnswers(contactId);
    const first = nextRelationshipQuestion(active, snapshot) ?? active[0]!;
    const now = new Date().toISOString();
    await upsertState(contactId, {
      status: "in_progress",
      current_question_key: first.question_key,
      intro_sent_at: now,
      started_at: state.started_at ?? now,
      pending_confirmation: null,
    });
    return {
      kind: "messages",
      texts: [config.intro_text, first.question_text],
      completed: false,
      question_key: first.question_key,
    };
  }

  const texts: string[] = [];
  let snapshot = await loadRelationshipAnswers(contactId);
  const askedKey: string | null =
    state.current_question_key ?? nextRelationshipQuestion(active, snapshot)?.question_key ?? null;

  if (inbound && inbound.text.trim()) {
    const pending = state.pending_confirmation as
      | { question_key: string; value: string; source: AnswerSource; message_id?: string | null }
      | null;

    // Gate says this is not an answer: answer the customer first. The
    // decision layer owns the reply; the questionnaire stays exactly where
    // it is so nothing false is captured and no question is repeated.
    if (gateBlocks && !(pending?.question_key && readConfirmationReply(inbound.text))) {
      return { kind: "none", reason: `inbound_${gate!.kind}` };
    }

    // --- awaiting a focused confirmation of an uncertain transcript -------
    if (pending?.question_key) {
      const reply = readConfirmationReply(inbound.text);
      if (reply === "yes") {
        await saveRelationshipAnswer({
          contactId,
          questionKey: pending.question_key,
          rawText: pending.value,
          structuredValue: { [pending.question_key]: pending.value, confirmed: true },
          source: pending.source,
          evidenceMessageId: pending.message_id ?? null,
          confidence: 95,
        });
        await upsertState(contactId, { pending_confirmation: null, last_answered_at: new Date().toISOString() });
        texts.push(acknowledgment(pending.question_key));
        snapshot = await loadRelationshipAnswers(contactId);
      } else if (reply === "no") {
        await upsertState(contactId, { pending_confirmation: null });
        const q = active.find((x) => x.question_key === pending.question_key);
        return {
          kind: "messages",
          texts: ["סליחה, לא הבנתי נכון.", q?.question_text ?? ""].filter(Boolean),
          completed: false,
          question_key: pending.question_key,
        };
      } else {
        // treat the message itself as the corrected answer
        if (!gateAllowsCapture) {
          return { kind: "none", reason: "inbound_not_a_valid_answer" };
        }
        await saveRelationshipAnswer({
          contactId,
          questionKey: pending.question_key,
          rawText: inbound.text.slice(0, 1000),
          structuredValue: { [pending.question_key]: inbound.text.slice(0, 1000) },
          source: inbound.source,
          evidenceMessageId: inbound.messageId ?? null,
          confidence: 90,
        });
        await upsertState(contactId, { pending_confirmation: null, last_answered_at: new Date().toISOString() });
        texts.push(acknowledgment(pending.question_key));
        snapshot = await loadRelationshipAnswers(contactId);
      }
    } else if (askedKey) {
      // --- explicit skip --------------------------------------------------
      if (isSkipRequest(inbound.text)) {
        await saveRelationshipAnswer({
          contactId,
          questionKey: askedKey,
          rawText: null,
          source: inbound.source,
          evidenceMessageId: inbound.messageId ?? null,
          skipped: true,
        });
        texts.push(acknowledgment(askedKey, { skipped: true }));
        snapshot = await loadRelationshipAnswers(contactId);
      } else if (
        isUncertainTranscript({
          transcript: inbound.text,
          confidence: inbound.transcriptConfidence ?? null,
          source: inbound.source,
        })
      ) {
        // --- uncertain voice: confirm before storing a structured value ---
        await upsertState(contactId, {
          pending_confirmation: {
            question_key: askedKey,
            value: inbound.text.slice(0, 500),
            source: inbound.source,
            message_id: inbound.messageId ?? null,
          },
        });
        return {
          kind: "messages",
          texts: [buildConfirmationQuestion(`אמרת ש${inbound.text.slice(0, 200)}`)],
          completed: false,
          question_key: askedKey,
        };
      } else {
        // --- normal answer: one message may resolve several questions -----
        if (!gateAllowsCapture) {
          return { kind: "none", reason: "inbound_not_a_valid_answer" };
        }
        const extracted = extractRelationshipFields(inbound.text, askedKey);
        const known = new Set(active.map((q) => q.question_key));
        for (const [key, val] of Object.entries(extracted)) {
          if (!known.has(key)) continue;
          if (key !== askedKey && snapshot.answers[key]) continue; // never overwrite silently
          await saveRelationshipAnswer({
            contactId,
            questionKey: key,
            rawText: key === askedKey ? inbound.text.slice(0, 1000) : val.value,
            structuredValue: { [key]: val.value, evidence: val.evidence },
            source: inbound.source,
            evidenceMessageId: inbound.messageId ?? null,
            confidence: val.confidence,
          });
        }
        await upsertState(contactId, { last_answered_at: new Date().toISOString() });
        texts.push(acknowledgment(askedKey));
        snapshot = await loadRelationshipAnswers(contactId);

        const follow = needsFollowUp(askedKey, inbound.text);
        if (follow) {
          await upsertState(contactId, { current_question_key: askedKey });
          return { kind: "messages", texts: [...texts, follow], completed: false, question_key: askedKey };
        }
      }
    }
  }

  // --- next question, or completion exactly once --------------------------
  const next = nextRelationshipQuestion(active, snapshot);
  if (next) {
    await upsertState(contactId, { current_question_key: next.question_key });
    return {
      kind: "messages",
      texts: [composeTurnText(texts[0] ?? null, next.question_text)],
      completed: false,
      question_key: next.question_key,
    };
  }

  if (state.completion_sent_at) return { kind: "none", reason: "completion_already_sent" };
  const now = new Date().toISOString();
  await upsertState(contactId, {
    status: "completed",
    current_question_key: null,
    completed_at: now,
    completion_sent_at: now,
    pending_confirmation: null,
  });
  // Internal admin-only AI profile. Async, idempotent and non-blocking: a
  // failure here can never fail the questionnaire completion.
  try {
    const { triggerRelationshipInsights } = await import("@/lib/relationship-insights/insights.server");
    triggerRelationshipInsights(contactId);
  } catch {
    /* ignore */
  }
  return {
    kind: "messages",
    texts: [composeTurnText(texts[0] ?? null, config.completion_text)],
    completed: true,
    question_key: null,
  };
}

// ------------------------------------------------------------------- UI

export async function getRelationshipIntakeSnapshot(contactId: string) {
  const [questions, state, snapshot, config] = await Promise.all([
    loadRelationshipQuestions(),
    loadRelationshipState(contactId),
    loadRelationshipAnswers(contactId),
    loadRelationshipConfig(),
  ]);
  const { data: history } = await db()
    .from("relationship_intake_answers")
    .select("question_key,raw_text,source,confidence,skipped_by_user,is_correction,is_current,answered_at,evidence_message_id")
    .eq("contact_id", contactId)
    .order("answered_at", { ascending: false })
    .limit(80);
  const { data: voice } = await db()
    .from("voice_transcripts")
    .select("wa_message_id,mime_type,duration_seconds,language,provider,model,transcript,status,created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(30);
  return {
    state,
    config,
    questions: sortedQuestions(questions),
    answers: snapshot.answers,
    progress: relationshipProgress(questions, snapshot),
    audit: (history as any[]) ?? [],
    voice: (voice as any[]) ?? [],
  };
}