# Canary "no reply" — diagnosis and proposed fix

## What actually happened (verified from production records)

Nothing is broken in delivery or configuration. Tamar deliberately stayed silent because the conversation is still marked as handed over to a human.

Stage-by-stage, all times Israel time, 21 Sep 2026, phone ***7533:

| Stage | Result |
|---|---|
| 1. Meta delivered to the webhook | OK — inbound events recorded at 18:49:40, 18:50:01, 18:50:24, 18:50:27, 18:50:38, 18:52:36 |
| 2. Signature / configuration | OK — every event was accepted and stored, no rejection recorded |
| 3. Number recognition | OK — the approved number was recognized every time; no block events exist |
| 4. Inbound accepted, brain ran | OK — a full brain run exists for each message, no errors, no fallback |
| 5. Outbound | Intentionally suppressed — the last four turns are recorded as "silent by policy" |

Why silent: at 18:02:48 a manager handover was opened (reason: ambiguity limit reached) and the contact was flagged as owned by a human. That handover is still open and unresolved (status "notified", never marked contacted or resolved). At 18:13 Tamar sent the single permitted "a team member will get back to you" status reply; from 18:50 onwards the runtime recorded "status already acknowledged" and stayed quiet by design, so no further messages were sent.

One send at 18:50:08 is logged as failed — that is the duplicate-reply guard rejecting a second message in the same turn, not a Meta delivery failure. Messages that were sent (18:49:48, 18:50:07) reached Meta and were marked delivered and read.

## Immediate unblock (no code change)

Either of these returns the conversation to Tamar:
- The Canary sends the restart phrase "התחל מחדש" (or "נתחיל מחדש") — the runtime returns ownership to Tamar when there is no active human handling.
- An administrator resolves the open handover in the Handoff screen, which records the outcome and hands control back.

## Proposed change (for approval)

1. Treat a handover that was never claimed or contacted by a manager within a defined window as not actively handled, so a customer who keeps writing gets real answers instead of permanent silence. No automatic release by time alone for handovers a manager did claim.
2. Surface the state to the operator: the contact card and the Handoff screen show "waiting for a manager since 18:02, customer wrote 4 more times, Tamar is quiet" with a one-click "return to Tamar" action.
3. Add an alert when a handover stays unresolved while new customer messages keep arriving.

## Technical notes

- Contact `9df95b11-afc4-41f9-ac6b-4f1ec5ce455e`: `conversation_state=human_handoff_queued`, `human_owned=true`, `manager_attention_required=true`, consent granted, not opted out, 24h window open until 22 Sep 18:52.
- `manager_handoffs` `c641e8e9…`: status `notified`, `contacted_at` and `resolved_at` null.
- `runtime_inbound_dedupe`: last four inbound rows `state=completed`, `no_reply_reason=silent_by_policy`.
- `tamar_runtime_executions` reasons: `automation_frozen_human_owned`, `handoff_status_reply` (18:13) then `handoff_activity_status_already_acked` (18:50+), `canonical.1` policy.
- Change would live in `src/lib/tamar-v2/handoff-activity.ts` / `handoff-activity.server.ts` (activity window definition) plus the handoff admin UI; no changes to groups, broadcasts, bridge, or Meta configuration.
