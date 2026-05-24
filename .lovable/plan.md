# Phase 1 — Tamar Operational Intelligence (first slice)

Goal: make Zooga the operational cockpit for Tamar. Server-backed only, proposal-first AI, no autonomous writes.

## 1. Per-contact conversation + memory viewer (contact profile)

Extend `/contacts/$id` with three new tabs alongside the existing AI Intelligence panel:

- **Timeline tab** — unified chronological feed from `interactions` (Tamar/WhatsApp messages), `messages` (outbound offers), `contact_profile_history` (AI/manager edits), `pending_ai_insights` (proposals), `tasks` (created/closed). Server-backed via a new `getContactTimeline` server fn that joins+sorts these tables, returns plain DTO.
- **Conversation tab** — focused live thread of `interactions` filtered to message-type rows, newest at bottom, auto-refresh every 15s + realtime channel. Shows direction (inbound/outbound), source channel, content.
- **Memory panel (existing AIIntelligencePanel)** — keep, already server-backed via `contact_memories` + `contact_profile_history` + `pending_ai_insights`. Add a small "insights count" badge to the tab.

Tabs implemented with shadcn `Tabs`. No new tables.

## 2. Decision visibility strip (top of contact profile)

New `<TamarDecisionStrip contactId>` card rendered above tabs. Shows:

- Active mode/flow: derived from latest `interactions.campaign_id` → `campaigns.intake_flow_type` + `campaigns.name`. Falls back to "qualification".
- Routing reason: derived rules — manager_attention_required → "escalated"; pending insights >0 → "low-confidence review"; recent interaction <24h → "active conversation"; else "idle".
- `manager_attention_required` badge (warning tone when true).
- Suggested next action: `contacts.ai_recommended_next_action` (or computed fallback: "Review N pending insights" / "Reply in conversation" / "Create follow-up task").

Single server fn `getTamarDecision({ contactId })` returns this DTO.

## 3. Tasks UI + handoff console

Activate the existing `tasks` table.

- New route `/tasks` (sidebar nav): list open/in-progress/done tasks with filters (status, priority, contact). Quick "complete" + "reopen" actions.
- Server fns: `listTasks(filters)`, `createTask({title, description, contactId?, priority, dueDate?, sourceInsightId?})`, `updateTaskStatus({id, status})`.
- On contact profile: small "Tasks" mini-panel with create-task button + list of that contact's tasks.
- Handoff console: new route `/handoff` (sidebar nav). Two sections:
  - Contacts with `manager_attention_required = true` (link to profile, quick "create task" + "clear flag" actions).
  - Pending insights across all contacts (already exist on contact page; this is the global queue). "Approve / Reject / Create task" actions per row.
- "Create task" buttons on pending insight rows + manager-attention rows pre-fill title/description/contactId.

## 4. Internal AI assistant (proposal-first)

New route `/ai-assistant` (sidebar nav).

- Single chat-style box with preset request types: Summary / Segmentation suggestion / Campaign draft / Triage suggestion / Free-form.
- Server fn `runInternalAIRequest({ kind, prompt, contextRefs? })` → calls Lovable AI Gateway (`google/gemini-2.5-flash` default) with a system prompt that enforces: "You produce proposals only. Never claim a write was performed. Always output: PROPOSAL, RATIONALE, SUGGESTED_NEXT_STEPS." Returns markdown response.
- Render with `react-markdown`. Each response shows a "Save as task" button (creates a task with the proposal text).
- No automatic DB writes from this surface.

## 5. Introspection updates

Update the existing `/api/introspect/*` files to reflect new live state:

- `frontend-map.ts`: add routes `/tasks`, `/handoff`, `/ai-assistant`; new screens; updated `implemented_modules` (handoff_console=true, internal_ai_assistant=true, tasks_ui=true); remove those from `planned_modules`.
- `ui-gaps.ts`: drop the now-shipped gaps; keep autonomous_campaign_agent + natural_language_targeting + analytics_dashboard.
- `agents-summary.ts`: add `internal_ai_assistant` (live, proposal-first), `handoff_console_ui` → live, `tasks_engine` → live.
- `crm-summary.ts`: add `tasks: {total, open, in_progress, done}` counters.
- `health-report.ts`: add module entries for tasks, handoff, ai_assistant.

## Files

New:
- `src/lib/contact-timeline.functions.ts`
- `src/lib/tamar-decision.functions.ts`
- `src/lib/tasks.functions.ts`
- `src/lib/internal-ai.functions.ts` (uses `LOVABLE_API_KEY`)
- `src/components/tamar-decision-strip.tsx`
- `src/components/contact-timeline.tsx`
- `src/components/contact-conversation.tsx`
- `src/components/contact-tasks-panel.tsx`
- `src/routes/_app.tasks.tsx`
- `src/routes/_app.handoff.tsx`
- `src/routes/_app.ai-assistant.tsx`

Modified:
- `src/routes/_app.contacts.$id.tsx` — add tabs + decision strip + tasks panel
- `src/routes/_app.tsx` — add nav entries (Tasks, Handoff, AI Assistant)
- 5 introspect endpoints listed above

## Non-goals (deferred)

- No schema changes (all tables already exist).
- No autonomous AI writes.
- No editing/deleting messages, no resend, no campaign auto-create.
- No analytics dashboard.
- Natural-language targeting + autonomous campaign agent stay planned.

After implementation I'll print the updated JSON from the 5 introspect endpoints.
