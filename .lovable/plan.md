
# Phase 2 — Zooga as Source of Truth for Tamar

Architectural rule baked into this slice: Zooga owns all durable CRM/intelligence/operational state. Tamar backend = WhatsApp runtime + webhook bridge + delivery layer only. No new long-term state ownership added to Tamar.

## 1. Server-backed conversation truth

- Replace direct-from-client Supabase reads in `contact-conversation.tsx` with a server fn `getContactConversation({ contactId, limit })` in `src/lib/contact-conversation.functions.ts` that returns a normalized DTO: `{ id, direction: 'inbound'|'outbound', channel, source, content, timestamp, campaign_id, related_offer_id }`.
- Single canonical query joining `interactions` (+ `messages` where channel/status applies), ordered by timestamp, scoped strictly by `contact_id`.
- Keep the realtime channel subscription for invalidation only; data comes from server fn via React Query. No client-side stitching of inbound/outbound logic — direction computed server-side.
- Result: conversation viewer reads exclusively from Zooga DB, tied to canonical contact id.

## 2. Canonical per-contact memory layer

- Normalize `contact_memories.memory_type` to a fixed taxonomy of 6: `fact`, `preference`, `warning`, `observation`, `relationship_signal`, `offer_signal`. Soft normalization in a server helper (map unknown → `observation`).
- New server fn `getContactMemories({ contactId })` returning grouped-by-category with `confidence_score`, `extracted_from`, `source_message` preserved.
- New `<ContactMemoryPanel>` (replacing/augmenting current AI panel usage on profile) with 6 category sections, confidence badges, source chip ("AI extracted" / "manual" / source message tooltip).
- Display rule: only server-backed memories from `contact_memories`. No client-only memory state.

## 3. Tamar decision context — real decision layer

Expand `TamarDecisionStrip` (+ new server fn `getTamarDecisionContext({ contactId })`) to surface:

- active mode/flow (from last interaction's campaign + `intake_flow_type`)
- routing reason (escalated / low-confidence-review / active-conversation / idle)
- `manager_attention_required` badge
- pending insight count + link to handoff filtered by contact
- suggested next action (`ai_recommended_next_action` fallback to computed)
- confidence band: derived from `contacts.ai_confidence_score` → `high (≥75) | medium (50–74) | low (<50)`
- linkage: count of open tasks for contact + open handoff entries, each clickable

## 4. Contact unified timeline

- New `<ContactTimeline>` component + server fn `getContactTimeline({ contactId, limit })` unifying events from:
  - `interactions` (messages, system events)
  - `messages` (outbound offers, channel sends)
  - `extracted_attributes` (insights extracted)
  - `contact_memories` (memory writes)
  - `pending_ai_insights` (pending review created/resolved)
  - `tasks` (created/status changes)
  - `contact_profile_history` (profile field changes)
  - `campaign_contacts` (campaign touches)
  - `contacts.offers_sent` derived (offer touches)
  - escalation events (derived from `manager_attention_required` transitions logged via `contact_profile_history`)
- DTO shape: `{ id, kind, timestamp, title, summary, meta, refs }` — server fn returns merged, sorted desc, limited.
- New tab `Timeline` on `/contacts/$id` becomes the default. Existing `Conversation` and `Memory` tabs remain.

## 5. Internal AI assistant grounded in system truth

- Extend `/api/public/ai-assistant/run` to accept a structured `request_type`: `summarize_contact`, `summarize_hot_leads_week`, `suggest_segment`, `draft_campaign`, `suggest_triage`, plus existing `free_form`.
- For each typed request the server gathers a scoped context bundle from Zooga (contact + memories + recent interactions; or aggregated hot-leads slice; or pending-insights snapshot) and injects it into the prompt as `SYSTEM_CONTEXT`.
- Response payload now includes `context_used`: `{ sources: [...], counts: {...}, contact_id?: ... }` rendered in the UI under each turn as a collapsible "Grounded in" panel.
- Still proposal-first: same `PROPOSAL / RATIONALE / SUGGESTED_NEXT_STEPS` envelope; no DB writes from this surface.
- Add `contact_id` optional input so contact-page can trigger `summarize_contact` directly.

## 6. Handoff ↔ task tightening

- Schema add (migration):
  - `pending_ai_insights.resolution_state` text default `pending` (`pending|resolved|under_human|returned_to_ai`)
  - `pending_ai_insights.linked_task_id` uuid nullable
  - `tasks.source_kind` text nullable (`pending_insight|manager_attention|ai_assistant|manual`)
  - `tasks.source_ref_id` uuid nullable
  - `tasks.resolution_state` text default `open` (mirrors status, extra: `under_human|returned_to_ai`)
- Handoff console: every row gets actions Approve / Reject / Create task (linked) / Mark under human / Return to AI. Creating a task auto-fills `source_kind=pending_insight` + `source_ref_id` + sets `linked_task_id` on the insight.
- Contact profile: shows linked open tasks + handoff entries inline in the decision strip and timeline.
- Resolution legend visible so managers know whether AI may resume.

## 7. Parallel-truth reduction

- All new server fns read from Zooga tables only. No fetches to Tamar backend for display data.
- Document this in `tamar-config` introspection: `memory_authority: "zooga"`, `conversation_authority: "zooga"`, `tamar_backend_role: "channel_runtime_only"`.

## 8. Introspection updates

Update the 7 endpoints requested:

- `frontend-map` — add timeline tab default, memory panel categories, decision strip v2, handoff resolution actions, AI-assistant typed requests.
- `ui-gaps` — drop: conversation-truth, memory-categories, decision-context-v2, unified-timeline, grounded-ai, handoff-task-linkage. Keep remaining (autonomous campaign agent, NL targeting, analytics dashboard).
- `agents-summary` — add `timeline_aggregator` (live), `memory_taxonomy_normalizer` (live), `grounded_ai_assistant` (live, replaces prior entry), `handoff_resolution_router` (live).
- `crm-summary` — add counters: memories by category, open tasks by source_kind, pending insights by resolution_state.
- `health-report` — add module entries: conversation-truth, memory-canonical, decision-context-v2, unified-timeline, grounded-ai, handoff-resolution.
- `tamar-config` — declare authority split (`memory_authority`, `conversation_authority`, `tamar_backend_role`); list memory taxonomy of 6.
- `tamar-routing` — add confidence bands + resolution states, document that routing reads from Zooga only.

After implementation I'll provide updated JSON outputs and explicitly confirm that no conversation/history/memory display path still reads from Tamar backend (only `interactions`/`messages`/`contact_memories`/`extracted_attributes` in Zooga).

## Technical notes

- New files: `src/lib/contact-conversation.functions.ts`, `src/lib/contact-memories.functions.ts`, `src/lib/contact-timeline.functions.ts`, `src/lib/tamar-decision.functions.ts`, `src/components/contact-memory-panel.tsx`, `src/components/contact-timeline.tsx`. Edits to: `contact-conversation.tsx`, `tamar-decision-strip.tsx`, `_app.contacts.$id.tsx`, `_app.handoff.tsx`, `_app.ai-assistant.tsx`, `api/public/ai-assistant/run.ts`, and the 7 introspect routes.
- One migration adds columns to `pending_ai_insights` and `tasks` (no destructive changes; defaults preserve existing rows).
- No schema changes to `contacts`, `interactions`, `messages`, `contact_memories`, `extracted_attributes`, `contact_profile_history`, `campaigns`.

## Non-goals

- No autonomous AI writes.
- No natural-language audience targeting (still planned).
- No autonomous campaign agent (still planned).
- No new state stored in Tamar backend.
- No analytics dashboard.
