# Zooga OS — Shadow Comparison Foundation (single batched milestone)

Goal: be able to compare the existing canonical Tamar/Zooga decision with a future Gateway-side shadow decision, with zero customer impact. No messages, no CRM writes, no traffic activation, no live LLM call.

## Scope boundary (hard)

- No inbound/outbound/live traffic toggles change; tenant zooga stays all-off.
- No contact, message, offer, or handoff row is written or updated by anything in this milestone.
- No real model call. The comparison ledger accepts a proposed decision from either (a) a Gateway response we already receive, or (b) a disabled mock adapter used only in tests. Model/provider/cost fields exist but stay null until a later milestone enables them.
- Sanitized inputs only: no raw message text, phone, email, name, token, or full CRM record. Only enum-ish/derived signals.

## 1. Database (one additive migration)

New table `public.zooga_shadow_runs` (tenant-scoped, append-mostly, immutable after terminal state):

- identity/correlation: `id`, `tenant_id`, `correlation_id`, `event_id` (matches `zooga_shadow_outbox.event_id`), `provider_message_id`, `canonical_decision_ref` (text: id of the `tamar_lite_decisions` / `tamar_decision_traces` row when available), `contact_ref_hash` (sha256 of contact id + tenant salt — never the id itself)
- sanitized input snapshot: `input_signals jsonb` (closed allow-list, validated in code), `input_hash text`
- canonical side: `canonical_action`, `canonical_state_before`, `canonical_state_after`, `canonical_reason_codes text[]`
- proposed side: `proposed_action`, `proposed_state_after`, `proposed_reason_codes text[]`, `proposed_confidence numeric`
- execution accounting: `provider text`, `model_id text`, `model_version text`, `latency_ms int`, `input_tokens int`, `output_tokens int`, `cost_usd numeric`, `error_code text`
- evaluation: `eval_status` enum-like text check (`pending`, `match`, `mismatch_action`, `mismatch_state`, `mismatch_reason_only`, `proposal_missing`, `canonical_missing`, `error`), `eval_reason_codes text[]`, `evaluated_at`
- lifecycle: `attempts int`, `max_attempts int`, `status text` (`open`, `finalized`, `dead`), `created_at`, `updated_at`, `expires_at` (retention default now() + 90 days)
- uniqueness/idempotency: `unique (tenant_id, event_id, run_kind)` where `run_kind` defaults to `'shadow_v1'`

Constraints and access:
- `GRANT ALL ON public.zooga_shadow_runs TO service_role;` only — no anon, no authenticated. Admin UI reads through the existing admin API route (service role, sanitized projection), so no direct Data API access is needed.
- `ENABLE ROW LEVEL SECURITY` with no permissive policy for anon/authenticated (deny-by-default).
- Append-only trigger `zooga_shadow_runs_immutable()`: block `DELETE`, and block `UPDATE` of identity/input/canonical columns once `status = 'finalized'`; allow only the proposal/eval/accounting columns to be filled once.
- `touch_updated_at` trigger.
- Retention helper `public.zooga_shadow_runs_prune(p_limit int)` — SECURITY DEFINER, service_role only, deletes rows past `expires_at` in bounded batches (the one exception to the delete guard, enforced inside the function).
- Indexes: `(tenant_id, created_at desc)`, `(tenant_id, eval_status)`, `(tenant_id, status)` partial on `status = 'open'`.

No changes to any existing table.

## 2. Code files

Add:
- `src/lib/zooga-gateway/shadow-compare.ts` (pure, client-safe): sanitized input allow-list projection `buildShadowInputSignals()`, `hashInputSignals()`, canonical/proposed comparison `evaluateShadowRun()` returning `{ eval_status, eval_reason_codes }`, and the closed reason-code vocabulary. All deterministic, no I/O.
- `src/lib/zooga-gateway/shadow-runs.server.ts` (server-only): `openShadowRun()` (idempotent upsert on `(tenant_id,event_id,run_kind)`), `recordProposedDecision()`, `finalizeShadowRun()` (runs `evaluateShadowRun`, writes eval fields, sets `status='finalized'`), `getShadowRunMetrics()` (aggregate counts by `eval_status`, mismatch rate, p50/p95 latency, error-code histogram, oldest open age). All via `supabaseAdmin`, all wrapped so a failure never throws into a caller.
- `src/lib/zooga-gateway/shadow-decision-adapter.ts`: the disabled adapter interface. Default export is a `disabled` implementation returning `{ error_code: "adapter_disabled" }`. A `mock` implementation exists for tests only. No network, no model.
- Tests: `src/lib/__tests__/zooga-shadow-compare.test.ts` (projection is allow-list-only, hashing stable, every eval branch), `src/lib/__tests__/zooga-shadow-runs.server.test.ts` (idempotent open, single finalize, error paths swallow), and extend `zooga-separation.test.ts` to assert no new Zooga file references `api_settings`, `webhook_token`, Meta/Tamar credentials, and that no Zooga source writes to contacts/messages/offers/handoffs tables.

Change (minimal):
- `src/lib/zooga-gateway/shadow-outbox.server.ts`: after a successful enqueue, also `openShadowRun()` with the same `event_id`/`correlation_id` and the sanitized signals. Best-effort, failure ignored, no behavior change to enqueue.
- Canonical capture: at the same webhook point that already enqueues the shadow envelope (`src/routes/api/public/webhook/tamar.ts`), pass the already-computed canonical action/state/reason codes into `openShadowRun`. Read-only use of values already in scope — no new queries, no new logic in the reply path.
- `src/routes/api/zooga/gateway-status.ts`: GET response gains `comparison` (sanitized metrics from `getShadowRunMetrics()`); POST additionally finalizes a bounded batch of open runs (`finalizeShadowRun` up to 20) and prunes expired rows (bounded). Still admin-only.
- `src/components/zooga-core-card.tsx`: read-only "השוואת Shadow" block — total runs, match / mismatch / pending counts, mismatch rate, p95 latency, top error code, oldest open age. Display only; no new actions beyond the existing drain button.
- `src/lib/zooga-gateway/status.ts`: extend the sanitizer with the `comparison` projection (numeric counters + short codes only), defaulting to empty, matching the existing `shadow` metrics pattern.

Nothing added under `src/routes/api/public/*`. The existing protected scheduler route stays as-is; finalize/prune can be attached to it in a later milestone once the comparison volume is observed.

## 3. Sequencing

1. Migration (table, grants, RLS, triggers, prune function, indexes).
2. Pure module `shadow-compare.ts` + its tests.
3. Server module `shadow-runs.server.ts` + adapter stub + tests.
4. Wire `openShadowRun` into the existing enqueue point (best-effort).
5. Extend status route + sanitizer + Control Center card.
6. Full test suite, typecheck, production build. No publish until reviewed.

## 4. Risks and mitigations

- PII leakage through `input_signals` — mitigated by a closed allow-list projection in pure code plus a test that rejects any unexpected key and asserts phone/text/name/email never appear.
- Reply-path regression from the new write — mitigated by best-effort semantics (`quiet()`-style) at a point that already performs a best-effort enqueue; failures log a fixed code only.
- Ledger growth — bounded by retention `expires_at` + prune function; metrics are aggregate queries with a row cap.
- Immutability vs. late-arriving proposals — resolved by the two-phase design: open (canonical + inputs) then a single finalize; the trigger blocks re-finalization.
- Correlation gaps when no canonical decision row exists — represented explicitly as `canonical_missing`, not silently dropped.

Rollback: the milestone is additive. Reverting means dropping `zooga_shadow_runs` (+ function/triggers) and removing the new modules and the two small call sites; existing Shadow transport and status behavior are unaffected.

## 5. Acceptance criteria

- New rows appear in `zooga_shadow_runs` for inbound events that already enqueue a shadow envelope, one per event (repeat delivery creates no duplicate).
- Every stored row passes the allow-list assertion; no phone, name, email, text, token, or full CRM record present.
- With the adapter disabled, runs finalize as `proposal_missing` with `error_code = 'adapter_disabled'` — proving the pipeline without any model call.
- Control Center shows comparison metrics for an admin; a non-admin gets 401/403.
- tenant zooga remains `live_traffic=false`, `inbound_enabled=false`, `outbound_enabled=false`; contact count and all customer rows unchanged.
- Full test suite, typecheck, and production build green.

## 6. Recommended single batch

Do items 1–6 of the sequencing as one batch (one migration + three new modules + three small wiring edits + tests). This is coherent and credit-efficient: the ledger is useless without capture, and capture is unverifiable without the read-only metrics view.
