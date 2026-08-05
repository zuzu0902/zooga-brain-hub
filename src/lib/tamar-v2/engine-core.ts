/**
 * TAMAR BRAIN V2 — the deterministic turn engine (PURE, no I/O).
 *
 * This function owns: consent, stage, next field, opt-out, offer eligibility
 * and handoff. The AI layer only supplies an `Interpretation` and optional
 * grounded wording (`answerText`); it can never move the state by itself.
 *
 * Being pure makes the whole policy testable offline — the scenario suite
 * runs this exact function with a deterministic interpreter.
 */
import {
  classifyConsent,
  detectSafetySignal,
  isConfusion,
  isExplicitOptIn,
  isExplicitOptOut,
  isUserQuestion,
  wantsExplanation,
} from "./classify";
import { automationFrozen, canTransition, marketingAllowed } from "./state-machine";
import type {
  AgentVersion,
  FlowStep,
  Interpretation,
  OutboundMessage,
  SellableOffer,
  TurnDecision,
  V2State,
} from "./types";

export type TurnInput = {
  state: V2State;
  message: string;
  /** stable id/value that came back on a button_reply / list_reply */
  optionId?: string | null;
  optionValue?: string | null;
  agent: AgentVersion;
  interpretation: Interpretation;
  knownFields: Record<string, string>;
  pendingStepKey?: string | null;
  ambiguityTurns: number;
  answeredCount: number;
  offers: SellableOffer[];
  firstName?: string | null;
  /** grounded answer text produced by the response writer, if any */
  answerText?: string | null;
};

const SITE = "https://www.zooga.co.il";

/**
 * The EXACT opener of every new conversation. Product-owned copy:
 * it must never be rephrased, prefixed or split, and it is always sent as
 * a WhatsApp interactive message with exactly two reply buttons.
 */
export const OPENER_TEXT =
  "שלום, אני תמר, העוזרת הדיגיטלית של קהילת זוגה. אשמח לשוחח איתך - האם את/ה מאשר לשלוח לך הודעות למספר הזה?";

export const CONSENT_BUTTONS = [
  { id: "consent_yes", label: "כן", value: "yes" },
  { id: "consent_no", label: "לא", value: "no" },
] as const;

/** The opener + consent question as ONE interactive button message. */
export function openerMessage(): OutboundMessage {
  return {
    kind: "buttons",
    body: OPENER_TEXT,
    header: null,
    options: CONSENT_BUTTONS.map((b) => ({ id: b.id, label: b.label, value: b.value })),
  };
}

function text(body: string): OutboundMessage {
  return { kind: "text", body };
}

function stepMessage(step: FlowStep): OutboundMessage {
  const options = step.options
    .filter((o) => o.enabled)
    .sort((a, b) => a.order_index - b.order_index)
    .map((o) => ({ id: o.option_id, label: o.label, value: o.value }));
  if (step.presentation === "text" || options.length === 0) {
    return text(step.help_text ? `${step.question_text}` : step.question_text);
  }
  // WhatsApp: max 3 reply buttons, max 10 list rows.
  const limit = step.presentation === "buttons" ? 3 : 10;
  return {
    kind: options.length <= 3 && step.presentation === "buttons" ? "buttons" : step.presentation === "buttons" ? "list" : "list",
    body: step.question_text,
    header: null,
    options: options.slice(0, limit),
  };
}

/** Backwards-compatible export: the opener body text. */
export function openerText(_agent?: AgentVersion, _firstName?: string | null): string {
  return OPENER_TEXT;
}

/**
 * The consent question. Always the same two stable buttons so that
 * button_reply.id is a contract, not a rendering detail.
 */
function consentMessage(_agent: AgentVersion): OutboundMessage {
  return openerMessage();
}

export const COPY = {
  consent_explain:
    "זוגה היא קהילה ישראלית לטיולים, אירועים והיכרויות. אני שולחת רק דברים שמתאימים למה שסיפרת לי, אפשר להפסיק בכל רגע, ואפשר תמיד לבקש לדבר עם אדם.",
  consent_yes_ack: "תודה 🙏 אשמח להכיר אותך קצת כדי להתאים לך דברים שבאמת מתאימים.",
  consent_no_close:
    "בסדר גמור, לא אשלח לך עדכונים. אם תרצה/י בעתיד אפשר לכתוב לי \"התחל\". תודה ולהתראות",
  opt_out_confirm:
    "הוסרת מרשימת הדיוור של זוגה ולא יישלח אליך תוכן שיווקי. אם תרצה/י לחזור — פשוט כתוב/כתבי \"התחל\". תודה ולהתראות",
  opt_in_ack: "שמחה שחזרת 🌿 נמשיך לעדכן אותך בטיולים ובאירועים של זוגה.",
  handoff_ack:
    "בשמחה — אני מעבירה אותך לאדם מהצוות של זוגה שיחזור אליך. מכאן אני עוצרת ולא אמשיך לשאול שאלות 🙏",
  clarify_generic:
    "רוצה לוודא שאני מבינה נכון 🙂 אפשר להסביר לי במשפט אחד מה הכי מעניין אותך? ואם נוח יותר — אפשר לבקש לדבר עם אדם מהצוות.",
  service_only_optout:
    "אני כאן ואשמח לעזור 🙂 שים/שימי לב שהוסרת מרשימת הדיוור, אז אני לא שולחת הצעות. אם תרצה/י שנחזור לעדכן — כתוב/כתבי \"התחל\", ובכל שלב אפשר לבקש לדבר עם אדם.",
  no_offer_honest:
    "אין לי כרגע משהו פתוח שמתאים בדיוק לזה, ואני מעדיפה לא להמציא. אפשר להעביר אותך לאדם מהצוות שיבדוק לעומק.",
} as const;

function baseDecision(input: TurnInput, over: Partial<TurnDecision>): TurnDecision {
  return {
    from_state: input.state,
    next_state: input.state,
    messages: [],
    actions: [],
    ask_step_key: null,
    captured: {},
    offer_ids: [],
    marketing_allowed: marketingAllowed(input.state),
    confidence_gate: "n/a",
    ambiguity_turns: input.ambiguityTurns,
    reason_codes: [],
    silent: false,
    ...over,
  };
}

/** Legal-transition guard: an illegal target keeps the current state. */
function target(input: TurnInput, to: V2State): V2State {
  return canTransition(input.state, to).allowed ? to : input.state;
}

function nextStep(agent: AgentVersion, known: Record<string, string>, stage: "intake" | "qualification"): FlowStep | null {
  const steps = agent.steps
    .filter((s) => s.enabled && s.stage === stage && s.step_key !== "consent")
    .sort((a, b) => a.order_index - b.order_index);
  for (const s of steps) {
    const key = s.field_key ?? s.step_key;
    const v = known[key];
    if (v === undefined || v === null || v === "") return s;
  }
  return null;
}

function handoffDecision(input: TurnInput, codes: string[], urgency: string): TurnDecision {
  return baseDecision(input, {
    next_state: target(input, "human_handoff_queued"),
    messages: [text(COPY.handoff_ack)],
    actions: ["handoff", "freeze"],
    marketing_allowed: false,
    reason_codes: [...codes, `urgency_${urgency}`],
  });
}

function recommendation(input: TurnInput): { messages: OutboundMessage[]; ids: string[] } {
  const max = Math.max(1, Math.min(3, input.agent.safety.max_offers ?? 2));
  const picked = input.offers.slice(0, max);
  if (!picked.length) return { messages: [text(COPY.no_offer_honest)], ids: [] };
  const lines = picked.map((o) => {
    const why = o.summary ? ` — ${String(o.summary).slice(0, 120)}` : "";
    const link = o.offer_url ? `\n${o.offer_url}` : "";
    return `• ${o.title}${why}${link}`;
  });
  return {
    messages: [text(`הנה מה שהכי מתאים למה שסיפרת לי:\n${lines.join("\n")}\n\nרוצה שאפרט על אחד מהם?`)],
    ids: picked.map((o) => o.id),
  };
}

/**
 * Decide the whole turn. Order of precedence is a safety hierarchy:
 *   freeze > human request > safety signal > opt-out > opener > consent >
 *   confidence gate > answer-first > intake > recommendation.
 */
export function decideTurn(input: TurnInput): TurnDecision {
  const msg = String(input.message ?? "").trim();
  const safety = input.agent.safety;
  const interp = input.interpretation;
  const signal = detectSafetySignal(msg);

  // 1. Frozen — a human owns the thread.
  if (automationFrozen(input.state)) {
    return baseDecision(input, {
      silent: true,
      marketing_allowed: false,
      reason_codes: [`automation_frozen_${input.state}`],
    });
  }

  // 2. Human request / distress / complaint — deterministic, pre-model.
  const humanRequested = signal.reason_codes.includes("explicit_human_request") || interp.wants_human;
  if ((safety.handoff_on_explicit_request && humanRequested) || (safety.handoff_on_distress && signal.handoff)) {
    const codes = signal.reason_codes.length ? signal.reason_codes : ["model_wants_human"];
    return handoffDecision(input, codes, signal.urgency);
  }

  // 3. Explicit opt-out at any point.
  if (isExplicitOptOut(msg) || (interp.intent === "opt_out" && !safety.optout_requires_explicit)) {
    return baseDecision(input, {
      next_state: target(input, "opted_out"),
      messages: [text(COPY.opt_out_confirm)],
      actions: ["opt_out"],
      marketing_allowed: false,
      reason_codes: ["explicit_opt_out"],
    });
  }

  // 4. Opted out: opt-in restores, otherwise a service-only reply (never silent).
  if (input.state === "opted_out") {
    if (isExplicitOptIn(msg)) {
      return baseDecision(input, {
        next_state: target(input, "consented"),
        messages: [text(COPY.opt_in_ack)],
        actions: ["opt_in"],
        reason_codes: ["explicit_opt_in"],
      });
    }
    return baseDecision(input, {
      messages: [text(input.answerText || COPY.service_only_optout)],
      marketing_allowed: false,
      reason_codes: ["opted_out_service_only"],
    });
  }

  // 5. First inbound — ALWAYS the exact opener, as ONE interactive message.
  if (input.state === "new_inbound") {
    return baseDecision(input, {
      next_state: target(input, "consent_asked"),
      messages: [openerMessage()],
      ask_step_key: "consent",
      marketing_allowed: false,
      reason_codes: ["first_inbound_opener"],
    });
  }

  // 6. Consent gate — consent is classified ONLY in this state.
  if (input.state === "consent_asked") {
    const answer = classifyConsent(msg, { optionValue: input.optionValue ?? null });

    if (answer === "yes") {
      const step = nextStep(input.agent, input.knownFields, "intake");
      const messages: OutboundMessage[] = [text(COPY.consent_yes_ack)];
      if (step) messages.push(stepMessage(step));
      return baseDecision(input, {
        next_state: target(input, step ? "intake_active" : "consented"),
        messages,
        actions: ["consent_granted"],
        ask_step_key: step?.step_key ?? null,
        ambiguity_turns: 0,
        reason_codes: ["consent_yes"],
      });
    }

    if (answer === "no") {
      return baseDecision(input, {
        next_state: target(input, "opted_out"),
        messages: [text(COPY.consent_no_close)],
        actions: ["opt_out"],
        marketing_allowed: false,
        ambiguity_turns: 0,
        reason_codes: ["consent_no"],
      });
    }

    if (answer === "explain" || wantsExplanation(msg)) {
      return baseDecision(input, {
        messages: [text(COPY.consent_explain), consentMessage(input.agent)],
        ask_step_key: "consent",
        marketing_allowed: false,
        ambiguity_turns: input.ambiguityTurns, // an explanation request is not ambiguity
        reason_codes: ["consent_explain"],
      });
    }

    // unknown / confusion — re-ask with buttons, count ambiguity, then hand off.
    const turns = input.ambiguityTurns + 1;
    if (turns >= Math.max(1, safety.ambiguity_limit)) {
      return handoffDecision({ ...input, ambiguityTurns: turns }, ["ambiguity_limit_reached"], "normal");
    }
    const lead = isConfusion(msg)
      ? "סליחה אם לא הייתי ברורה 🙂 "
      : "רק כדי לוודא שהבנתי נכון 🙂 ";
    return baseDecision(input, {
      messages: [text(lead + COPY.consent_explain), consentMessage(input.agent)],
      ask_step_key: "consent",
      marketing_allowed: false,
      ambiguity_turns: turns,
      reason_codes: [isConfusion(msg) ? "consent_confusion" : "consent_unknown"],
    });
  }

  // 7. Confidence gate — below threshold nothing advances and nothing is sold.
  const gateNeeded = interp.source !== "deterministic";
  if (gateNeeded && interp.confidence < safety.min_confidence_state_change) {
    const turns = input.ambiguityTurns + 1;
    if (turns >= Math.max(1, safety.ambiguity_limit)) {
      return handoffDecision({ ...input, ambiguityTurns: turns }, ["low_confidence_ambiguity_limit"], "normal");
    }
    return baseDecision(input, {
      messages: [text(COPY.clarify_generic)],
      confidence_gate: "blocked",
      marketing_allowed: false,
      ambiguity_turns: turns,
      reason_codes: ["low_confidence"],
    });
  }

  // ---- consented / intake_active / recommendation_ready / value_delivered ----
  const captured: Record<string, string> = {};
  if (input.pendingStepKey) {
    const step = input.agent.steps.find((s) => s.step_key === input.pendingStepKey);
    const key = step?.field_key ?? step?.step_key ?? null;
    if (key) {
      const optValue = input.optionValue?.trim();
      const entity = interp.entities?.[key];
      // A tapped button always captures: by resolved value, else by its title.
      const fromMessage = msg && (step?.presentation === "text" || !!input.optionId) ? msg : "";
      const value = optValue || entity || fromMessage;
      if (value) captured[key] = String(value).slice(0, 300);
    }
  }
  for (const [k, v] of Object.entries(interp.entities ?? {})) {
    if (v && !captured[k]) captured[k] = String(v).slice(0, 300);
  }
  const known = { ...input.knownFields, ...captured };
  const answeredCount = input.answeredCount + (Object.keys(captured).length ? 1 : 0);

  const messages: OutboundMessage[] = [];
  const reason: string[] = [];
  const actions: TurnDecision["actions"] = Object.keys(captured).length ? ["capture_field"] : [];

  // 8. Answer-first: a customer question is answered before anything else.
  const asked = isUserQuestion(msg) || interp.intent === "question";
  if (asked && input.answerText) {
    messages.push(text(input.answerText));
    reason.push("answer_first");
  } else if (input.answerText && interp.intent !== "smalltalk") {
    messages.push(text(input.answerText));
    reason.push("grounded_reply");
  }

  // 9. Recommendation — only sellable offers, capped, never the whole catalog.
  const wantsOffers =
    interp.intent === "browse_offers" ||
    interp.intent === "offer_interest" ||
    /(טיול|הצעה|הצעות|מה\s+יש|אירוע|חופשה)/.test(msg);
  const enoughContext = answeredCount >= 2 || Object.keys(known).length >= 3;
  const canMarket = marketingAllowed(input.state) && interp.confidence >= safety.min_confidence_marketing;

  if (canMarket && wantsOffers && !input.offers.length) {
    messages.push(text(COPY.no_offer_honest));
    return baseDecision(input, {
      messages,
      actions,
      captured,
      confidence_gate: "pass",
      reason_codes: [...reason, "no_sellable_offer"],
    });
  }

  if (canMarket && (wantsOffers || enoughContext) && input.offers.length) {
    const rec = recommendation(input);
    messages.push(...rec.messages);
    reason.push("recommend_offers");
    return baseDecision(input, {
      next_state: target(input, "recommendation_ready"),
      messages,
      actions: [...actions, "recommend"],
      captured,
      offer_ids: rec.ids,
      confidence_gate: "pass",
      ambiguity_turns: 0,
      reason_codes: reason,
    });
  }

  // 10. Exactly ONE intake question per message.
  const stage: "intake" | "qualification" = input.state === "recommendation_ready" ? "qualification" : "intake";
  const step = nextStep(input.agent, known, stage);
  if (step && safety.max_questions_per_message >= 1) {
    messages.push(stepMessage(step));
    reason.push("ask_next_field");
    return baseDecision(input, {
      next_state: target(input, "intake_active"),
      messages,
      actions,
      captured,
      ask_step_key: step.step_key,
      confidence_gate: "pass",
      ambiguity_turns: 0,
      reason_codes: reason,
    });
  }

  // 11. Nothing left to ask — never stay silent.
  if (!messages.length) {
    messages.push(text(`תודה 🙏 אני כאן אם תרצה/י שנמצא משהו מתאים, או לדבר עם אדם מהצוות. אפשר גם להציץ באתר: ${SITE}`));
    reason.push("acknowledge");
  }
  return baseDecision(input, {
    next_state: target(input, "value_delivered"),
    messages,
    actions,
    captured,
    confidence_gate: "pass",
    ambiguity_turns: 0,
    reason_codes: reason,
  });
}
