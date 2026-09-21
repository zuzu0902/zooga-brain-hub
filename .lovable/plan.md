# Tamar canonical conversation policy update

## Goal
Make Tamar consistently behave as a warm Zooga host and concierge: answer the current request first, never introduce a specific offer unasked, and use the approved post-consent opening before intake begins.

## Implementation
1. Add one canonical conversation-policy module containing the exact approved Hebrew messages, recognition of a customer saying they already know Zooga, the unsolicited-offer rule, and a customer-facing Hebrew cleanliness check.
2. Wire that policy into Tamar V2’s deterministic turn flow:
   - after consent, send only `האם אתה מכיר את זוגה או שתרצה שאספר לך קצת עלינו?`;
   - do not begin configured intake questions until that opening is answered;
   - when the customer says they know Zooga, return exactly `איזה כיף! אני אשמח להכיר אותך קצת יותר אישית כדי להתאים לך רעיונות בהמשך. יש לך כמה דקות שנדבר?`;
   - preserve the ongoing state so later replies continue normally rather than replaying the opening.
3. Tighten the canonical planner, response selector, writer prompt, and shared runtime prompt so specific trips, destinations, events, or offers are named only after the customer explicitly asks about that item, asks what is available, or asks for a recommendation. Keep answer-first, one-question maximum, truthful grounding, consent, and opt-out precedence unchanged.
4. Replace only customer-facing fallback/template wording reached by these paths when it contains foreign or internal implementation language. Add a send-time policy check for this behavior so generated text cannot leak model/tool/state jargon or an unsolicited catalog item.

## Focused verification
- Exact post-consent opening, with no intake question appended.
- Exact known-Zooga reply.
- No unsolicited trip, destination, event, offer, or catalog mention.
- Explicit product questions and recommendation requests still receive grounded answers.
- Customer-visible output rejects foreign fragments and internal model/tool/state terminology.
- Concierge tone, answer-first behavior, and at most one natural follow-up.
- Existing consent, opt-out, canary, handoff, delivery, and canonical response tests remain green.
- Run the affected Vitest suites, TypeScript check, and production build; do not publish.

## Scope safeguards
No database migration or data change. No changes to group/broadcast code, Meta credentials, delivery safety, consent storage, canary gating, or unrelated UI.

## Technical notes
Likely touchpoints are `src/lib/tamar-v2/engine-core.ts`, the canonical policy/response guard layer, `writer.server.ts`, `planner.server.ts`, `src/lib/tamar-runtime-composition.ts`, and focused Tamar V2 tests. Existing exact consent and opt-out messages remain unchanged except for the newly approved post-consent sequence.
