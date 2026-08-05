/**
 * TAMAR BRAIN V2 — acceptance scenarios.
 *
 * The SAME list powers the offline vitest suite and the Studio simulator,
 * so "green in CI" and "green in the admin UI" mean the same thing.
 * Every scenario runs against the pure engine with the deterministic
 * interpreter — no model, no network, no live contact.
 */
import { decideTurn } from "./engine-core";
import { interpretDeterministic } from "./interpret-rules";
import {
  DEFAULT_IDENTITY,
  DEFAULT_SAFETY,
  type AgentVersion,
  type FlowStep,
  type SellableOffer,
  type V2State,
} from "./types";

function step(
  step_key: string,
  field_key: string | null,
  stage: string,
  question_text: string,
  presentation: FlowStep["presentation"],
  order_index: number,
  options: Array<[string, string]> = [],
): FlowStep {
  return {
    step_key,
    field_key,
    stage,
    question_text,
    help_text: null,
    presentation,
    required: true,
    skippable: true,
    conditions: {},
    order_index,
    enabled: true,
    options: options.map(([label, value], i) => ({
      option_id: `${step_key}_${i + 1}`,
      label,
      value,
      order_index: i + 1,
      enabled: true,
    })),
  };
}

export const TEST_AGENT: AgentVersion = {
  id: null,
  version: 1,
  status: "active",
  identity: DEFAULT_IDENTITY,
  safety: DEFAULT_SAFETY,
  steps: [
    step("consent", "consent_marketing", "consent", "אפשר להמשיך לשלוח לך כאן עדכונים והצעות מזוגה?", "buttons", 10, [
      ["כן, בשמחה", "yes"],
      ["לא, תודה", "no"],
      ["רוצה הסבר", "explain"],
    ]),
    step("relationship_status", "relationship_status", "intake", "מה המצב המשפחתי שלך?", "list", 20, [
      ["רווק/ה", "single"],
      ["גרוש/ה", "divorced"],
      ["אלמן/ה", "widowed"],
      ["בזוגיות", "couple"],
    ]),
    step("goal", "goal", "intake", "מה הכי מעניין אותך בזוגה?", "list", 30, [
      ["טיולים", "trips"],
      ["אירועים חברתיים", "events"],
      ["היכרויות", "dating"],
    ]),
    step("preferred_activity", "preferred_activity", "intake", "איזה סוג פעילות הכי מתאים לך?", "list", 40, [
      ["טיול בחו״ל", "abroad"],
      ["טיול בארץ", "domestic"],
      ["מפגש חברתי", "meetup"],
    ]),
    step("region", "region", "intake", "מאיזה אזור בארץ?", "list", 50, [
      ["צפון", "צפון"],
      ["מרכז", "מרכז"],
      ["דרום", "דרום"],
    ]),
    step("special_requests", "special_requests", "intake", "יש משהו מיוחד שחשוב לך שאדע?", "text", 70),
  ],
};

export const TEST_OFFERS: SellableOffer[] = [
  { id: "o1", title: "טיול לאלבניה", offer_url: "https://www.zooga.co.il/albania", summary: "8 ימים, קבוצה ישראלית" },
  { id: "o2", title: "סופ״ש בצפון", offer_url: "https://www.zooga.co.il/north", summary: "סופ״ש חברתי" },
];

export type Expectation = {
  next_state?: V2State;
  action?: string;
  no_action?: string;
  reason?: string;
  silent?: boolean;
  marketing_allowed?: boolean;
  asks?: string | null;
  includes?: string;
  excludes?: string;
  max_questions?: number;
  offers_max?: number;
};

export type Scenario = {
  name: string;
  category: string;
  state: V2State;
  inbound: string;
  optionId?: string;
  known?: Record<string, string>;
  pendingStepKey?: string | null;
  ambiguityTurns?: number;
  answeredCount?: number;
  offers?: SellableOffer[];
  answerText?: string | null;
  expect: Expectation;
};

const QUESTION_MARKS = /[?？]/g;

/**
 * Resolve a scenario option against WHATEVER agent version is running.
 * A scenario may name a real option id, the fixed consent ids, or a
 * positional id ("goal_1" = the first option of the `goal` step), so the same
 * suite is valid for the test agent and for the live admin-edited flow.
 */
function resolveOption(agent: AgentVersion, sc: Scenario): { id: string | null; value: string | null } {
  const wanted = sc.optionId;
  if (!wanted) return { id: null, value: null };
  const consent: Record<string, string> = { consent_yes: "yes", consent_no: "no", consent_explain: "explain" };
  if (consent[wanted]) return { id: wanted, value: consent[wanted]! };
  const direct = agent.steps.flatMap((s) => s.options).find((o) => o.option_id === wanted);
  if (direct) return { id: direct.option_id, value: direct.value };
  const m = /^(.*)_(\d+)$/.exec(wanted);
  if (m) {
    const stepKey = m[1]!;
    const idx = Number(m[2]) - 1;
    const step = agent.steps.find((s) => s.step_key === stepKey) ?? agent.steps.find((s) => s.step_key === (sc.pendingStepKey ?? ""));
    const opt = step?.options.filter((o) => o.enabled)[idx];
    if (opt) return { id: opt.option_id, value: opt.value };
    if (stepKey === "consent") return idx === 1 ? { id: "consent_no", value: "no" } : { id: "consent_yes", value: "yes" };
  }
  return { id: wanted, value: null };
}

export function runScenario(sc: Scenario, agent: AgentVersion = TEST_AGENT) {
  const interpretation = interpretDeterministic(sc.inbound);
  const opt = resolveOption(agent, sc);
  const decision = decideTurn({
    state: sc.state,
    message: sc.inbound,
    optionId: opt.id,
    optionValue: opt.value,
    agent,
    interpretation,
    // The contact's name is already known from the WhatsApp profile, so a
    // `first_name` step in the live flow is never re-asked in the suite.
    knownFields: { first_name: "דנה", ...(sc.known ?? {}) },
    pendingStepKey: sc.pendingStepKey ?? null,
    ambiguityTurns: sc.ambiguityTurns ?? 0,
    answeredCount: sc.answeredCount ?? 0,
    offers: sc.offers ?? TEST_OFFERS,
    firstName: "דנה",
    answerText: sc.answerText ?? null,
  });

  const body = decision.messages.map((m) => m.body).join("\n");
  const failures: string[] = [];
  const e = sc.expect;
  if (e.next_state && decision.next_state !== e.next_state) failures.push(`state ${decision.next_state} != ${e.next_state}`);
  if (e.action && !decision.actions.includes(e.action as any)) failures.push(`missing action ${e.action}`);
  if (e.no_action && decision.actions.includes(e.no_action as any)) failures.push(`forbidden action ${e.no_action}`);
  if (e.reason && !decision.reason_codes.some((r) => r.includes(e.reason!))) failures.push(`missing reason ${e.reason}`);
  if (e.silent !== undefined && decision.silent !== e.silent) failures.push(`silent ${decision.silent} != ${e.silent}`);
  if (e.marketing_allowed !== undefined && decision.marketing_allowed !== e.marketing_allowed)
    failures.push(`marketing ${decision.marketing_allowed} != ${e.marketing_allowed}`);
  if (e.asks !== undefined && decision.ask_step_key !== e.asks) failures.push(`asks ${decision.ask_step_key} != ${e.asks}`);
  if (e.includes && !body.includes(e.includes)) failures.push(`body missing "${e.includes}"`);
  if (e.excludes && body.includes(e.excludes)) failures.push(`body contains forbidden "${e.excludes}"`);
  if (e.max_questions !== undefined) {
    const q = (body.match(QUESTION_MARKS) ?? []).length;
    if (q > e.max_questions) failures.push(`too many questions: ${q}`);
  }
  if (e.offers_max !== undefined && decision.offer_ids.length > e.offers_max) failures.push(`too many offers: ${decision.offer_ids.length}`);
  if (!decision.silent && decision.messages.length === 0) failures.push("empty reply");
  return { decision, interpretation, failures, passed: failures.length === 0 };
}

const consentButtons = { pendingStepKey: "consent" };

export const SCENARIOS: Scenario[] = [
  // ---------- opener / consent ----------
  { name: "greeting opens with identity + consent", category: "consent", state: "new_inbound", inbound: "שלום", expect: { next_state: "consent_asked", asks: "consent", includes: "אני לא בן אדם", reason: "first_inbound_opener", marketing_allowed: false } },
  { name: "hi in english opens", category: "consent", state: "new_inbound", inbound: "hi", expect: { next_state: "consent_asked", asks: "consent" } },
  { name: "first message that is a question still opens", category: "consent", state: "new_inbound", inbound: "יש טיול לאלבניה?", expect: { next_state: "consent_asked", asks: "consent", marketing_allowed: false } },
  { name: "greeting never treated as ambiguous consent", category: "consent", state: "new_inbound", inbound: "היי", expect: { reason: "first_inbound_opener" } },
  { name: "consent yes advances to intake", category: "consent", state: "consent_asked", inbound: "כן", expect: { next_state: "intake_active", action: "consent_granted", asks: "relationship_status" } },
  { name: "consent yes by button", category: "consent", state: "consent_asked", inbound: "כן, בשמחה", optionId: "consent_1", ...consentButtons, expect: { action: "consent_granted" } },
  { name: "consent no closes once, exact sign-off", category: "consent", state: "consent_asked", inbound: "לא, תודה", expect: { next_state: "opted_out", action: "opt_out", includes: "תודה ולהתראות" } },
  { name: "consent no by button", category: "consent", state: "consent_asked", inbound: "לא", optionId: "consent_2", ...consentButtons, expect: { next_state: "opted_out" } },
  { name: "explain request explains and re-asks", category: "consent", state: "consent_asked", inbound: "רוצה הסבר", expect: { asks: "consent", reason: "consent_explain", next_state: "consent_asked" } },
  { name: "confusion is not a no", category: "consent", state: "consent_asked", inbound: "לא הבנתי", expect: { next_state: "consent_asked", no_action: "opt_out", reason: "consent_confusion" } },
  { name: "bare question mark is confusion", category: "consent", state: "consent_asked", inbound: "?", expect: { next_state: "consent_asked", no_action: "opt_out" } },
  { name: "מה ? is confusion", category: "consent", state: "consent_asked", inbound: "מה ?", expect: { no_action: "opt_out", reason: "consent_confusion" } },
  { name: "second ambiguity hands off, never silent", category: "consent", state: "consent_asked", inbound: "אהה", ambiguityTurns: 1, expect: { next_state: "human_handoff_queued", action: "handoff", silent: false } },
  { name: "consent state never markets", category: "consent", state: "consent_asked", inbound: "יש טיולים?", expect: { marketing_allowed: false, excludes: "אלבניה" } },
  { name: "consent yes with punctuation", category: "consent", state: "consent_asked", inbound: "כן!", expect: { action: "consent_granted" } },
  { name: "אוקיי counts as yes", category: "consent", state: "consent_asked", inbound: "אוקיי", expect: { action: "consent_granted" } },

  // ---------- opt-out / opt-in ----------
  { name: "explicit הסר opts out", category: "optout", state: "intake_active", inbound: "הסר", expect: { next_state: "opted_out", action: "opt_out" } },
  { name: "unsubscribe english", category: "optout", state: "consented", inbound: "stop", expect: { next_state: "opted_out", action: "opt_out" } },
  { name: "אל תשלחי לי phrase", category: "optout", state: "intake_active", inbound: "אל תשלחי לי יותר הודעות", expect: { action: "opt_out" } },
  { name: "negation inside sentence is NOT opt-out", category: "optout", state: "intake_active", inbound: "לא בטוח שאני רוצה טיול ארוך", expect: { no_action: "opt_out" } },
  { name: "opted-out user still gets service reply", category: "optout", state: "opted_out", inbound: "מתי הטיול יוצא?", expect: { silent: false, marketing_allowed: false, no_action: "recommend" } },
  { name: "opted-out user opts back in", category: "optout", state: "opted_out", inbound: "התחל", expect: { next_state: "consented", action: "opt_in" } },
  { name: "opted-out never receives offers", category: "optout", state: "opted_out", inbound: "יש טיולים?", expect: { offers_max: 0, marketing_allowed: false } },

  // ---------- handoff ----------
  { name: "explicit human request hands off", category: "handoff", state: "intake_active", inbound: "אפשר לדבר עם נציג?", expect: { next_state: "human_handoff_queued", action: "handoff" } },
  { name: "handoff also freezes automation", category: "handoff", state: "intake_active", inbound: "תעבירי אותי לאדם", expect: { action: "freeze" } },
  { name: "handoff acknowledges the customer", category: "handoff", state: "consented", inbound: "רוצה לדבר עם מישהו מהצוות", expect: { includes: "מעבירה אותך" } },
  { name: "distress hands off at high urgency", category: "handoff", state: "intake_active", inbound: "עברתי משבר קשה מאז שבעלי נפטר", expect: { action: "handoff", reason: "urgency_high" } },
  { name: "complaint hands off", category: "handoff", state: "value_delivered", inbound: "יש לי תלונה, לא קיבלתי החזר כספי", expect: { action: "handoff", reason: "urgency_high" } },
  { name: "bot frustration hands off", category: "handoff", state: "intake_active", inbound: "את בוט? זה לא עוזר לי", expect: { action: "handoff" } },
  { name: "frozen thread stays silent", category: "handoff", state: "human_owned", inbound: "היי, מה קורה?", expect: { silent: true } },
  { name: "queued handoff stays silent", category: "handoff", state: "human_handoff_queued", inbound: "עוד משהו", expect: { silent: true } },
  { name: "handoff never markets", category: "handoff", state: "intake_active", inbound: "תעבירי לנציג", expect: { marketing_allowed: false, offers_max: 0 } },

  // ---------- intake ----------
  { name: "one question per message", category: "intake", state: "intake_active", inbound: "בסדר", expect: { max_questions: 1 } },
  { name: "asks the first missing field", category: "intake", state: "intake_active", inbound: "אוקיי", expect: { asks: "relationship_status" } },
  { name: "skips a known field", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single" }, expect: { asks: "goal" } },
  { name: "captures a list answer by option id", category: "intake", state: "intake_active", inbound: "רווק/ה", optionId: "relationship_status_1", pendingStepKey: "relationship_status", expect: { action: "capture_field", asks: "goal" } },
  { name: "captures free text for a text step", category: "intake", state: "intake_active", inbound: "חשוב לי חדר ליחיד", pendingStepKey: "special_requests", known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad", region: "מרכז" }, expect: { action: "capture_field" } },
  { name: "no budget question during intake", category: "intake", state: "intake_active", inbound: "אוקיי", expect: { excludes: "תקציב" } },
  { name: "budget never asked before recommendation", category: "intake", state: "consented", inbound: "כן", expect: { excludes: "תקציב" } },
  { name: "region entity captured from free text", category: "intake", state: "intake_active", inbound: "אני מהצפון", known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad" }, expect: { action: "capture_field" } },
  { name: "intake never invents an offer", category: "intake", state: "intake_active", inbound: "אוקיי", offers: [], expect: { offers_max: 0 } },
  { name: "intake reply is never empty", category: "intake", state: "intake_active", inbound: "המממ", expect: { silent: false } },

  // ---------- recommendation ----------
  { name: "browse intent recommends", category: "offers", state: "consented", inbound: "אילו טיולים יש לכם?", answerText: null, expect: { action: "recommend", next_state: "recommendation_ready" } },
  { name: "recommendation capped by max_offers", category: "offers", state: "consented", inbound: "מה יש לכם?", expect: { offers_max: 2 } },
  { name: "recommendation includes the sales link", category: "offers", state: "consented", inbound: "אילו טיולים יש?", expect: { includes: "https://www.zooga.co.il/albania" } },
  { name: "no sellable offers = honest answer", category: "offers", state: "consented", inbound: "יש טיולים?", offers: [], expect: { includes: "מעדיפה לא להמציא", offers_max: 0 } },
  { name: "offers only after consent", category: "offers", state: "consent_asked", inbound: "אילו טיולים יש?", expect: { offers_max: 0 } },
  { name: "enough context triggers a recommendation", category: "offers", state: "intake_active", inbound: "מעניין אותי טיול", answeredCount: 2, known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad" }, expect: { action: "recommend" } },
  { name: "recommendation asks a single follow-up", category: "offers", state: "consented", inbound: "אילו טיולים יש?", expect: { max_questions: 1 } },

  // ---------- grounded answers ----------
  { name: "question is answered before any new question", category: "answer", state: "intake_active", inbound: "כמה ימים הטיול לאלבניה?", answerText: "הטיול לאלבניה הוא 8 ימים.", expect: { includes: "8 ימים", reason: "answer_first" } },
  { name: "answer-first still asks at most one question", category: "answer", state: "intake_active", inbound: "מה כולל הטיול?", answerText: "הטיול כולל טיסות ולינה.", expect: { max_questions: 1 } },
  { name: "missing price is answered honestly", category: "answer", state: "consented", inbound: "כמה זה עולה?", answerText: "אין לי את המחיר הסופי כאן, אפשר לבדוק מול הצוות.", expect: { includes: "אין לי את המחיר" } },
  { name: "unknown fact never invented", category: "answer", state: "intake_active", inbound: "יש טיול ליפן?", answerText: "אין לי כרגע טיול ליפן.", expect: { includes: "אין לי כרגע טיול ליפן" } },

  // ---------- safety / integrity ----------
  { name: "never claims to be human", category: "safety", state: "new_inbound", inbound: "שלום", expect: { includes: "אני לא בן אדם" } },
  { name: "empty message still replies", category: "safety", state: "intake_active", inbound: "", expect: { silent: false } },
  { name: "gibberish does not opt out", category: "safety", state: "intake_active", inbound: "אסדגכדג", expect: { no_action: "opt_out" } },
  { name: "human request beats opt-out keyword order", category: "safety", state: "intake_active", inbound: "תעבירי אותי לנציג בבקשה", expect: { action: "handoff", no_action: "opt_out" } },
  { name: "value_delivered keeps momentum", category: "safety", state: "value_delivered", inbound: "תודה", known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad", region: "מרכז", special_requests: "אין" }, expect: { silent: false } },
  { name: "recommendation state can ask qualification", category: "safety", state: "recommendation_ready", inbound: "מעניין", expect: { silent: false } },

  // ---------- consent edge cases ----------
  { name: "returning consented contact skips the opener", category: "consent", state: "consented", inbound: "היי", expect: { next_state: "intake_active", asks: "relationship_status" } },
  { name: "yes with emoji", category: "consent", state: "consent_asked", inbound: "כן 🙂", expect: { action: "consent_granted" } },
  { name: "בשמחה is yes", category: "consent", state: "consent_asked", inbound: "בשמחה", expect: { action: "consent_granted" } },
  { name: "בהחלט is yes", category: "consent", state: "consent_asked", inbound: "בהחלט", expect: { action: "consent_granted" } },
  { name: "אין צורך is no", category: "consent", state: "consent_asked", inbound: "אין צורך", expect: { next_state: "opted_out" } },
  { name: "לא מעוניינת is no", category: "consent", state: "consent_asked", inbound: "לא מעוניינת", expect: { next_state: "opted_out" } },
  { name: "explain button keeps consent state", category: "consent", state: "consent_asked", inbound: "הסבר", optionId: "consent_3", pendingStepKey: "consent", expect: { next_state: "consent_asked", asks: "consent" } },
  { name: "מי את is an explain request", category: "consent", state: "consent_asked", inbound: "מי את?", expect: { no_action: "opt_out" } },
  { name: "consent close is a single message", category: "consent", state: "consent_asked", inbound: "לא, תודה", expect: { max_questions: 0 } },
  { name: "consent no never asks another question", category: "consent", state: "consent_asked", inbound: "לא", expect: { asks: null } },
  { name: "opener includes the agent name", category: "consent", state: "new_inbound", inbound: "שלום", expect: { includes: "תמר" } },
  { name: "opener greets by first name", category: "consent", state: "new_inbound", inbound: "היי", expect: { includes: "דנה" } },
  { name: "opener offers a human", category: "consent", state: "new_inbound", inbound: "בוקר טוב", expect: { includes: "לדבר עם מישהו מהצוות" } },
  { name: "first inbound with an opt-out word still opts out", category: "consent", state: "new_inbound", inbound: "הסר", expect: { next_state: "opted_out" } },
  { name: "first inbound asking for a human hands off", category: "consent", state: "new_inbound", inbound: "אני רוצה לדבר עם נציג", expect: { action: "handoff" } },
  { name: "consent yes then intake keeps marketing allowed", category: "consent", state: "consent_asked", inbound: "כן", expect: { next_state: "intake_active" } },

  // ---------- intake depth ----------
  { name: "asks goal after relationship status", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single" }, expect: { asks: "goal" } },
  { name: "asks activity after goal", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single", goal: "trips" }, expect: { asks: "preferred_activity" } },
  { name: "asks region after activity", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad" }, expect: { asks: "region" } },
  { name: "asks special requests last", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single", goal: "trips", preferred_activity: "meetup", region: "מרכז" }, expect: { asks: "special_requests" } },
  { name: "list option captured for goal", category: "intake", state: "intake_active", inbound: "טיולים", optionId: "goal_1", pendingStepKey: "goal", known: { relationship_status: "single" }, expect: { action: "capture_field" } },
  { name: "captured value is not re-asked", category: "intake", state: "intake_active", inbound: "היכרויות", optionId: "goal_3", pendingStepKey: "goal", known: { relationship_status: "single" }, expect: { asks: "preferred_activity" } },
  { name: "free text region entity", category: "intake", state: "intake_active", inbound: "אני גרה בדרום", known: { relationship_status: "single", goal: "trips", preferred_activity: "abroad" }, expect: { action: "capture_field" } },
  { name: "couple detected as travel party", category: "intake", state: "intake_active", inbound: "אנחנו זוג ורוצים להירשם ביחד", expect: { action: "capture_field" } },
  { name: "solo traveller detected", category: "intake", state: "intake_active", inbound: "אני נוסעת לבד", expect: { action: "capture_field" } },
  { name: "intake never asks two questions", category: "intake", state: "intake_active", inbound: "אוקיי", known: { relationship_status: "single" }, expect: { max_questions: 1 } },
  { name: "intake reply mentions no price", category: "intake", state: "intake_active", inbound: "אוקיי", expect: { excludes: "₪" } },
  { name: "empty option id ignored", category: "intake", state: "intake_active", inbound: "לא יודעת", pendingStepKey: "goal", known: { relationship_status: "single" }, expect: { silent: false } },
  { name: "intake continues after a statement", category: "intake", state: "intake_active", inbound: "נחמד", expect: { asks: "relationship_status" } },
  { name: "all fields known moves to value delivered", category: "intake", state: "intake_active", inbound: "תודה", known: { relationship_status: "single", goal: "dating", preferred_activity: "meetup", region: "צפון", special_requests: "אין" }, offers: [], expect: { next_state: "value_delivered" } },
  { name: "value delivered reply offers a human", category: "intake", state: "intake_active", inbound: "תודה", known: { relationship_status: "single", goal: "dating", preferred_activity: "meetup", region: "צפון", special_requests: "אין" }, offers: [], expect: { includes: "אדם מהצוות" } },

  // ---------- offers depth ----------
  { name: "explicit destination triggers offers", category: "offers", state: "consented", inbound: "יש טיול לאלבניה?", expect: { action: "recommend" } },
  { name: "offer list is capped at two", category: "offers", state: "intake_active", inbound: "מה יש לכם בטיולים?", expect: { offers_max: 2 } },
  { name: "offers include titles", category: "offers", state: "consented", inbound: "אילו טיולים יש?", expect: { includes: "טיול לאלבניה" } },
  { name: "offers never sent while frozen", category: "offers", state: "human_owned", inbound: "אילו טיולים יש?", expect: { offers_max: 0, silent: true } },
  { name: "offers never sent while queued", category: "offers", state: "human_handoff_queued", inbound: "אילו טיולים יש?", expect: { offers_max: 0 } },
  { name: "recommendation moves the state forward", category: "offers", state: "intake_active", inbound: "מה יש לכם בטיולים?", expect: { next_state: "recommendation_ready" } },
  { name: "event interest also recommends", category: "offers", state: "consented", inbound: "יש אירוע קרוב?", expect: { action: "recommend" } },
  { name: "vacation wording recommends", category: "offers", state: "consented", inbound: "רוצה חופשה", expect: { action: "recommend" } },
  { name: "no offers available never invents", category: "offers", state: "consented", inbound: "יש טיול ליפן?", offers: [], expect: { excludes: "יפן" } },
  { name: "recommendation keeps one follow-up question", category: "offers", state: "consented", inbound: "יש אירועים?", expect: { max_questions: 1 } },

  // ---------- answer / honesty ----------
  { name: "price question answered from facts", category: "answer", state: "consented", inbound: "כמה עולה הטיול?", answerText: "המחיר מתחיל ב-1,200 דולר לאדם בחדר זוגי.", expect: { includes: "1,200" } },
  { name: "date question answered", category: "answer", state: "intake_active", inbound: "מתי יוצא הטיול?", answerText: "הטיול יוצא ב-12 בספטמבר.", expect: { includes: "12 בספטמבר" } },
  { name: "answer precedes the next question", category: "answer", state: "intake_active", inbound: "מה כולל המחיר?", answerText: "המחיר כולל טיסות ולינה.", expect: { reason: "answer_first" } },
  { name: "answer without a question is still delivered", category: "answer", state: "consented", inbound: "מעניין אותי", answerText: "יש לנו קבוצה שיוצאת בקרוב.", offers: [], expect: { includes: "קבוצה שיוצאת בקרוב" } },
  { name: "solo traveller reassurance from facts", category: "answer", state: "intake_active", inbound: "אפשר להירשם לבד?", answerText: "בהחלט אפשר להירשם לבד, רוב המשתתפים מגיעים לבד.", expect: { includes: "אפשר להירשם לבד" } },
  { name: "unknown availability answered honestly", category: "answer", state: "consented", inbound: "יש עוד מקומות?", answerText: "אין לי נתון עדכני על מקומות פנויים.", expect: { includes: "אין לי נתון עדכני" } },

  // ---------- safety depth ----------
  { name: "payment problem hands off", category: "safety", state: "value_delivered", inbound: "חויבתי פעמיים על הטיול", expect: { action: "handoff", reason: "urgency_high" } },
  { name: "legal threat hands off", category: "safety", state: "intake_active", inbound: "אני פונה לעורך דין", expect: { action: "handoff" } },
  { name: "widowhood is treated with care", category: "safety", state: "intake_active", inbound: "התאלמנתי לאחרונה", expect: { action: "handoff", reason: "urgency_high" } },
  { name: "handoff never asks an intake question", category: "safety", state: "intake_active", inbound: "תעבירי לנציג", expect: { asks: null } },
  { name: "frozen thread captures nothing", category: "safety", state: "human_owned", inbound: "אני מהצפון", expect: { silent: true, no_action: "capture_field" } },
  { name: "paused thread stays silent", category: "safety", state: "paused", inbound: "היי", expect: { silent: true } },
  { name: "opt-out beats a browse intent", category: "safety", state: "consented", inbound: "הסירו אותי", expect: { action: "opt_out", offers_max: 0 } },
  { name: "opted-out user is never asked a question", category: "safety", state: "opted_out", inbound: "מה שלומך?", expect: { asks: null } },
  { name: "long rambling message still replies", category: "safety", state: "intake_active", inbound: "אני לא ממש יודעת מה אני מחפשת אולי טיול אולי לא תלוי בתאריכים ובאנשים", expect: { silent: false } },
  { name: "english inbound still handled", category: "safety", state: "intake_active", inbound: "what trips do you have?", expect: { silent: false } },
  { name: "numbers only message replies", category: "safety", state: "intake_active", inbound: "12345", expect: { silent: false } },
  { name: "emoji only message replies", category: "safety", state: "intake_active", inbound: "🙂", expect: { silent: false } },
  { name: "state never illegally jumps", category: "safety", state: "new_inbound", inbound: "אילו טיולים יש?", expect: { next_state: "consent_asked" } },
  { name: "handoff from recommendation state", category: "safety", state: "recommendation_ready", inbound: "אפשר לדבר עם בן אדם?", expect: { action: "handoff" } },
  { name: "opt-in from opted_out never markets in the same turn", category: "safety", state: "opted_out", inbound: "התחל", expect: { offers_max: 0 } },
  { name: "value delivered can return to intake", category: "safety", state: "value_delivered", inbound: "בעצם מעניין אותי גם היכרויות", expect: { silent: false } },
  { name: "no forbidden pressure wording", category: "safety", state: "consented", inbound: "אילו טיולים יש?", expect: { excludes: "הזדמנות אחרונה" } },
  { name: "no medical or therapy framing", category: "safety", state: "intake_active", inbound: "אוקיי", expect: { excludes: "טיפול" } },
  { name: "reply never claims a discount", category: "safety", state: "consented", inbound: "אילו טיולים יש?", expect: { excludes: "הנחה" } },
  { name: "reply never promises availability", category: "safety", state: "consented", inbound: "אילו טיולים יש?", expect: { excludes: "מובטח" } },
];
