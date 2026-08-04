import { describe, it } from "vitest";
import { simulateTurn } from "@/lib/tamar-brain/simulate.server";

const S: Array<[string, string, string]> = [
  ["1 opener", "consent_pending", "היי"],
  ["2 consent yes", "consent_pending", "כן"],
  ["3 consent no", "consent_pending", "לא מעוניין"],
  ["4 stop", "consented", "הסר אותי"],
  ["5 browse", "consented", "איזה טיולים יש לך?"],
  ["6 albania", "consented", "יש טיול לאלבניה?"],
  ["7 price", "consented", "כמה זה עולה?"],
  ["8 couple", "consented", "אנחנו זוג, אפשר להירשם ביחד?"],
  ["9 solo", "consented", "אני לבד, זה בסדר?"],
  ["10 human", "consented", "אני רוצה לדבר עם נציג"],
  ["11 complaint", "consented", "זה נורא, אני מאוכזב מאוד"],
  ["12 distress", "consented", "אני במצוקה קשה"],
  ["13 goodbye", "consented", "תודה, להתראות"],
  ["14 frozen", "human_owned", "מה קורה?"],
  ["15 closed", "closed", "היי שוב"],
  ["16 dates", "consented", "מתי היציאה הקרובה?"],
  ["17 offtopic", "consented", "מה מזג האוויר?"],
  ["18 intake", "consented", "אני בת 62 מהמרכז"],
];

describe("18 scenarios", () => {
  for (const [name, state, msg] of S) {
    it(name, async () => {
      const r = await simulateTurn({ message: msg, state: state as any });
      console.log(JSON.stringify({ name, state: r.state, frozen: r.automation_frozen, consent: r.consent_classification, handoff: r.handoff_signal, q: r.user_question, bye: r.goodbye, allowed: r.allowed_actions, hits: r.knowledge_hits, action: (r.plan as any)?.action ?? null, reply: (r.plan as any)?.reply ?? null }));
    }, 60000);
  }
});
