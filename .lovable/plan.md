## Problem

Albania is fully eligible (active, future event_date, ingestion_status=ready, tags+summary present, in the catalog list returned to prod) and IS injected on regex-detected browse turns. But on a direct destination question like "יש טיול לאלבניה?", the runtime resolver pins to the sticky `latest_interaction_offer` (Vietnam 60+) and skips catalog injection, so Albania is never named in the prompt and Tamar answers from the wrong offer.

Root cause is in `src/routes/api/public/runtime/tamar-turn.ts`:

```
const weakResolution = !offer || resolutionTrail.some(t => t.startsWith("stale_interaction_skipped"));
const shouldInjectCatalog = browseIntentDetected || weakResolution;
```

Three signals that should force catalog injection are ignored:
1. The user explicitly names a destination/keyword that does NOT match the resolved sticky offer.
2. The LLM relevance pass already returns `llm_offer_relevance.relevant=false` for the sticky offer — but the value is recorded for trace only, never fed into `shouldInjectCatalog`.
3. The sticky offer came from `latest_interaction_offer` (low-confidence trail), not from a keyword/campaign/explicit match.

## Fix

Edit `src/routes/api/public/runtime/tamar-turn.ts` only.

### 1. Add destination-mismatch detection
Run the existing `keywordMatchOffer` over the full eligible catalog against the inbound message. If it returns an offer whose id is different from the resolved sticky offer, set `destinationMismatch = true`. This catches "יש טיול לאלבניה" → keyword match on Albania while sticky is Vietnam.

### 2. Honor the LLM relevance verdict
If `llm_offer_relevance.relevant === false` with non-trivial confidence (≥ 50) on the resolved offer, set `llmSaysIrrelevant = true`.

### 3. Treat sticky-only resolution as weak
Extend `weakResolution` to also be true when the resolution trail is exactly `["latest_interaction_offer"]` AND the inbound contains a destination/keyword signal (use a light regex: destination names from `matching_tags` of the active catalog, plus the existing CATALOG_BROWSE_RE).

### 4. New injection condition

```
const shouldInjectCatalog =
  browseIntentDetected ||
  weakResolution ||
  destinationMismatch ||
  llmSaysIrrelevant;
```

### 5. When `destinationMismatch` fires, also un-pin the sticky offer
If the keyword-matched offer from the catalog differs from the sticky offer, swap `offer` to the keyword-matched one (or set `offer = null` if we prefer to surface the full catalog). Add a resolution trail entry `destination_keyword_override`.

This means "יש טיול לאלבניה?" will:
- Resolve `offer` to the Albania record directly, OR
- At minimum inject the full active catalog (including Albania) into the prompt so Tamar names it.

### 6. Trace
Surface `destination_mismatch`, `llm_says_irrelevant`, and `sticky_overridden_to` in `active_context_layers.offer_event` so future regressions are visible in Runtime Trace without DB digging.

## Non-goals

- No DB / schema changes; Albania's data is already correct.
- No changes to intake priority, hard reply rules, or the LLM model.
- No changes to `CATALOG_BROWSE_RE` (keep it conservative; the new signals cover the named-destination case).
- No edits to `intake-workflow.ts` or `tamar-runtime-composition.ts`.

## Verification

- Re-run a turn with "יש טיול לאלבניה?" against the same contact and confirm in `tamar_runtime_executions.raw_payload->active_context_layers->offer_event`:
  - `catalog_injected: true`
  - `catalog_offer_ids` includes `bb2ecea1-37a9-45e1-9a14-04a21f2596d3`
  - Either `resolved_offer_id` flips to the Albania id, or sticky is kept but catalog is injected.
- Confirm existing browse-intent turns still inject the catalog (regression check).
- Confirm offer-specific turns where the user stays on-topic still resolve to the correct sticky offer and do NOT over-inject the catalog.
