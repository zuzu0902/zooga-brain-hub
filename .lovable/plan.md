## Intake Workflow V1 — Plan

A real, server-side intake workflow layer that runs every turn in parallel with memory, offer/event context, and handoff. Tamar stays one unified representative — intake never suppresses answering an offer/product question, and offer relevance never suspends intake.

### 1. Database changes (one migration)

Add structured intake state to `contacts` (keep flat — UI and trace already read from contacts; avoids a join on every turn):

- `intake_state` text — `not_started | active | paused | completed | blocked | handoff` (replaces today's free-text `intake_status` which holds values like `ask_name`; we keep the legacy column untouched and stop writing to it).
- `intake_stage` text — `identity | demographic | preferences | qualification | completed`
- `intake_required_fields` text[] — frozen V1 checklist (see §3).
- `intake_completed_fields` text[] — captured with sufficient confidence.
- `intake_missing_fields` text[] — derived, persisted for fast UI/trace reads.
- `intake_last_question_key` text
- `intake_last_question_at` timestamptz
- `intake_last_captured_field` text
- `intake_last_captured_at` timestamptz
- `intake_completion_score` int (0–100)

Plus a small append-only log for observability:

- `intake_field_captures` (id, contact_id, field_key, value_text, confidence, source `prompt|user_volunteered|extractor`, runtime_execution_id, created_at) with the standard GRANT + RLS block and `service_role` ALL.

### 2. Required-field checklist (V1, frozen)

Stored on each contact at first turn into `intake_required_fields`:

1. `first_name`
2. `age_or_birth_date` (satisfied by `birth_date` OR `age` OR `age_range`)
3. `city_or_region` (satisfied by `city` OR `region`)
4. `social_or_relationship_goal` (maps to `social_goals` / `relationship_goals`)
5. `preferred_activity_type` (maps to `favorite_activity_types` / `preferred_events`)
6. `budget_sensitivity_or_range` (maps to `budget_sensitivity` / `price_sensitivity` / `income_range`)
7. `language_style_preference` (maps to `preferred_language_style`)
8. `source_attribution` (auto-satisfied from `source` / `campaign_source` / inbound payload — never asked aloud)

`source_attribution` is captured automatically on contact create/turn — it never produces a question.

### 3. Deterministic next-question logic (server-side)

New module `src/lib/intake-workflow.ts`:

- `computeIntakeSnapshot(contact)` → resolves each required field against existing contact columns + `intake_completed_fields`; returns `{ completed, missing, completion_score, stage }`. Stage derives from which bucket the next missing field lives in (identity → demographic → preferences → qualification → completed).
- `selectNextIntakeField(snapshot, { lastAskedKey, lastAskedAt, lastInboundIgnoredAsk })` → returns the next target field by the priority order above, with these rules:
  - skip fields already known
  - skip the field asked last turn if the user ignored it (no answer detected) — defer it 1 turn, then try again
  - never return more than one field per turn
  - returns `null` once all are completed → sets `intake_state='completed'`
- `composeIntakeDirective(nextField, contact)` → small Hebrew nudge string ("ואגב, איך נוח לך שאקרא לך?") injected as a *soft addendum* in the system prompt, not a replacement for the answer.

### 4. Runtime integration (tamar-turn.ts)

In the turn handler, after context load and before composition:

1. Build `intakeSnapshot` from the loaded contact.
2. Select `nextIntakeField` using snapshot + last-question state.
3. Pass `intake` block into `buildTamarRuntimeComposition` alongside (not instead of) memory / offer / profile. The composition's `activeContextLayers.intake_progress` becomes the real snapshot (status, stage, next_target_field, missing, completion_score). System prompt gets a single line: "Intake target this turn: <field> — weave ONE natural question AFTER answering the user, never before, never if the turn is a handoff."
4. After the model reply, run `extractIntakeCaptures(message, reply, contact)` — a deterministic extractor for the V1 fields (name regex, age/birthdate parsing, city list, language style hints, plus a confidence score). High-confidence (>=75) captures:
   - update the structured contact column
   - append to `intake_field_captures`
   - move field from missing → completed
   - update `intake_last_captured_field/_at` and `intake_completion_score`
   Low-confidence captures are logged to `pending_ai_insights` (existing table) instead of overwriting the profile.
5. If `nextIntakeField` was asked, persist `intake_last_question_key/_at`.
6. Intake state updates happen regardless of `conversationMode` — including `offer_specific`, `support`, and `handoff` (state survives handoff; we just don't ask a new question on a handoff turn).

### 5. CRM visibility (contact detail page)

In `src/routes/_app.contacts.$id.tsx`, add an "Intake Progress" card near the AI panel showing:

- status badge + stage badge
- completion score progress bar (X/8 fields)
- chips: completed fields (green), missing fields (muted)
- last question asked (key + timestamp)
- last captured field (key + timestamp)
- collapsed "Capture log" expander reading from `intake_field_captures` (last 10).

### 6. Runtime Trace visibility

In `src/routes/_app.runtime-trace.tsx`, expand the existing intake chip into a small block per trace row:

- `intake_active` (yes/no)
- `intake_status`, `intake_stage`
- `next_target_field`
- `captured_fields_this_turn` (from `intake_field_captures` joined by `runtime_execution_id`)
- `completion_score_after_turn`

Source: `tamar_runtime_executions.raw_payload.active_context_layers.intake_progress` (already wired) — we just enrich the payload server-side.

### 7. Handoff & offer coexistence

- Handoff: intake state is read on handoff and included in the manager alert payload (top-level `intake_stage`, `intake_missing_fields`, `intake_completion_score`) so Alex sees what's known and what's still missing.
- Offer-specific turns: offer intelligence stays fully available; intake directive is added as a parallel soft nudge. Offer answers come first; intake question (if any) is appended after.

### Files changed

1. New migration `supabase/migrations/<ts>_intake_workflow_v1.sql` — adds columns above + `intake_field_captures` table with GRANT/RLS.
2. New `src/lib/intake-workflow.ts` — snapshot, next-field selection, directive composer, extractor.
3. `src/routes/api/public/runtime/tamar-turn.ts` — invoke intake on every turn, write captures, update contact, enrich `active_context_layers.intake_progress`, enrich manager handoff payload.
4. `src/lib/tamar-runtime-composition.ts` — accept `intake` input and emit a single-line directive in system prompt (parallel layer, not mode-gated).
5. `src/routes/_app.contacts.$id.tsx` — Intake Progress card.
6. `src/routes/_app.runtime-trace.tsx` — expanded intake block per row.
7. `src/routes/api/introspect/tamar-routing.ts` — update `intake_stages` to reflect V1 stages.

### Technical details

```text
Turn pipeline (every inbound):
 ┌───────────────────────────────────────────────────────────────┐
 │ resolve contact → load context (mem/offer/campaign)           │
 │ snapshot = computeIntakeSnapshot(contact)                     │
 │ next    = selectNextIntakeField(snapshot, lastAsk)            │
 │ mode    = decideConversationMode(...)   ← unchanged            │
 │ compose prompt with ALL layers in parallel                    │
 │   memory + profile + offer + intake.next + mode-emphasis      │
 │ call model → reply                                             │
 │ extract captures from (inbound + reply) → persist             │
 │ update intake_*, append intake_field_captures                  │
 │ write tamar_runtime_executions with enriched intake snapshot   │
 │ if handoff → manager alert includes intake snapshot            │
 └───────────────────────────────────────────────────────────────┘
```

Confidence threshold for auto-persist: 75 (matches existing `auto_apply_confidence_min`). Below that → `pending_ai_insights`.

### What remains partial after V1 (explicitly out of scope)

- LLM-based intake extractor (V1 uses deterministic regex/keyword extractor for the 8 fields; the existing `intelligence-extractor` stays as the slower nightly pass).
- Per-flow intake variants (today's `INTAKE_FLOWS` script questions stay as-is; V1 checklist is flow-agnostic. Per-flow overrides come in V2.)
- Re-ask backoff beyond "skip 1 turn if ignored".
- Manual intake reset / override UI (read-only V1 in CRM; mutations later).
- Intake analytics dashboard (counts, drop-off funnel) — V2.
- Multi-language extraction tuning beyond Hebrew/English heuristics.
