/**
 * PILOT NO-ANSWER LIFECYCLE (PURE).
 *
 * If the opener gets no reply, Tamar sends AT MOST ONE approved individual
 * follow-up after 48 hours, then stops for good and raises a visible CRM /
 * admin alert. Every decision here is idempotent: the same state always
 * produces the same action, and once an alert exists nothing else happens.
 */
export const PILOT_FOLLOWUP_HOURS = 48;
export const PILOT_CONSENT_WORDING_VERSION = "pilot_consent_v1";

export type PilotLifecycleState = {
  opener_sent_at: string | null;
  followup_sent_at: string | null;
  no_response_at: string | null;
  /** any inbound message from the customer, at any time */
  last_inbound_at: string | null;
  opted_out_at?: string | null;
  human_owned?: boolean | null;
  consent_granted?: boolean | null;
};

export type PilotLifecycleAction = "none" | "send_followup" | "raise_no_response_alert";

export type PilotLifecycleDecision = {
  action: PilotLifecycleAction;
  reason: string;
  reason_he: string;
  /** hours since the last outreach, for the operator table */
  hours_since_last_outreach: number | null;
};

function hoursBetween(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

export function decidePilotLifecycle(
  state: PilotLifecycleState,
  now: Date = new Date(),
  followupHours = PILOT_FOLLOWUP_HOURS,
): PilotLifecycleDecision {
  const last = state.followup_sent_at ?? state.opener_sent_at ?? null;
  const elapsed = hoursBetween(last, now);
  const done = (reason: string, reason_he: string): PilotLifecycleDecision => ({
    action: "none",
    reason,
    reason_he,
    hours_since_last_outreach: elapsed,
  });

  if (state.opted_out_at) return done("opted_out", "הלקוח ביקש להפסיק קבלת הודעות");
  if (state.human_owned) return done("human_owned", "השיחה בטיפול אנושי");
  if (!state.opener_sent_at) return done("opener_not_sent", "טרם נשלחה הודעת פתיחה");

  // Any reply after the opener ends the no-answer lifecycle for good.
  const openerAt = Date.parse(state.opener_sent_at);
  const inboundAt = state.last_inbound_at ? Date.parse(state.last_inbound_at) : NaN;
  if (!Number.isNaN(inboundAt) && !Number.isNaN(openerAt) && inboundAt >= openerAt) {
    return done("customer_replied", "הלקוח הגיב");
  }
  if (state.consent_granted) return done("consent_granted", "התקבלה הסכמה");
  if (state.no_response_at) return done("alert_already_raised", "כבר נפתחה התראה על אי-מענה");

  if (!state.followup_sent_at) {
    if ((elapsed ?? 0) < followupHours) return done("followup_window_open", "ממתין ל-48 שעות");
    return {
      action: "send_followup",
      reason: "followup_due",
      reason_he: "הגיע מועד המעקב היחיד",
      hours_since_last_outreach: elapsed,
    };
  }

  if ((elapsed ?? 0) < followupHours) return done("alert_window_open", "ממתין לתשובה אחרי המעקב");
  return {
    action: "raise_no_response_alert",
    reason: "no_response",
    reason_he: "אין מענה — נדרשת התראה ב-CRM",
    hours_since_last_outreach: elapsed,
  };
}

/** The single approved individual follow-up. Never promises perks or offers. */
export function pilotFollowupText(firstName: string | null | undefined): string {
  const name = String(firstName ?? "").trim();
  return (
    `${name ? `היי ${name}, ` : "היי, "}זו תמר מקהילת זוגה 🙂 ` +
    `רק מוודאת שההודעה הקודמת הגיעה. אם מתאים לך שאשלח לך עדכונים על אירועים וטיולים — כתבי/כתוב לי "כן", ` +
    `ואם לא, זה בסדר גמור ולא אפריע יותר.`
  );
}

export function pilotNoResponseAlert(args: { contactId: string; firstName?: string | null }) {
  return {
    kind: "pilot_no_response" as const,
    contact_id: args.contactId,
    title: "אין מענה לפנייה הראשונה של תמר",
    body: `${args.firstName?.trim() || "איש הקשר"} לא הגיב/ה לפנייה הראשונה ולמעקב היחיד. האוטומציה נעצרה.`,
  };
}
