## 1. Runtime Trace — exact latest turn

Pulled from `tamar_runtime_executions` (latest 3 rows, all same contact `87073646…6b33`, "קובי"):

| field | value |
|---|---|
| runtime_trace_id | `f002d842-e830-4602-aafa-83b93e45b4e5` |
| created_at | 2026-06-10 01:19:42 UTC |
| inbound | `יש יעדים נוספים ?` |
| reply | `היי קובי, וייטנאם הוא יעד מבוקש מאוד... אבל אנחנו מציעים מגוון יעדים נוספים. ...האם אתה מחפש משהו יותר נגיש או שפתוח גם להשקעה קצת יותר גבוהה...` |
| conversation_mode | `generic_intake` |
| conversation_mode_reasons | `["no_strong_offer_evidence","weak_resolution:latest_interaction_offer"]` |
| resolved_offer_id | `1afaec91-4c77-4715-aceb-633f5bbe6093` (Vietnam) |
| resolved_campaign_id | `null` |
| offer_intelligence_injected | **true** (but for Vietnam, not Dubai) |
| campaign_injected | false |
| runtime_mode | `zooga_direct` |
| active_context_layers.offer_event | `{ offer_id: 1afaec91…, offer_title: "טיול לבני 60+ לוייטנאם", campaign_id: null, resolution_trail: ["latest_interaction_offer"] }` |

The two previous turns at 01:19:17 and 01:08:13 show the identical pattern — Vietnam pinned, Dubai never appears.

## 2. New trip state in production

`offers.id = dbff14e9-bbae-4308-b94a-421d25a8e974`

| field | value |
|---|---|
| title | דובאי ואבו דאבי 5 ימים של יוקרה ופאר 13-17/10 |
| status | **active** |
| price / currency | 1649 USD |
| offer_url | `https://zooga.me` |
| description | "מחזור שני לדובאי בשנת 2026. והפעם יותר יוקרתי…" |
| matching_tags | `{דובאי, "אבו דאבי", "טיול בוטיק", יוקרה, ספארי, סינגלים, "זוגות בפרק ב'", אוקטובר}` |
| ai_summary | present (full Hebrew summary) |
| grounded_facts | present (dates, hotel, flights, meals, activities) |
| faq_bundle | present (7 Q&A) |
| objection_notes | present (3 entries) |
| sales_angle | present |
| escalation_boundary | present (`must_escalate` + `tamar_can_answer`) |
| ingestion_status | **ready** |
| last_ingested_at | 2026-06-10 **01:13:27** UTC (≈6 min before the failing turn) |

So the trip is fully present, active, and analyzed in production well before the turn.

## 3. Resolution diagnosis

Code: `src/routes/api/public/runtime/tamar-turn.ts` → `resolveCampaignAndOffer` (lines 463-558). Resolution order is:

1. explicit `offer_id` from payload — not provided
2. explicit `campaign_id` — not provided
3. `contact.last_touch_campaign_id` — not set
4. **latest `interactions` row for this contact with a `related_offer_id`** → matched Vietnam → pushed `latest_interaction_offer` to trail and **returned immediately** with `offer = Vietnam`
5/6/7. never executed because step 4 already populated `offer`

So:
- **Was the new Dubai trip eligible?** Yes — `status=active`, `ingestion_status=ready`, ingested 6 min earlier, fully analyzed.
- **Why wasn't it resolved?** Because step 4 sticky-latches to the most recent interaction's `related_offer_id` (Vietnam, from a previous conversation), so the resolver short-circuits before keyword/multi-offer logic ever runs.
- **Keyword path:** would not have fired anyway — the inbound `יש יעדים נוספים?` contains no Dubai token (`דובאי`, `אבו דאבי`, etc.), so `keywordMatchOffer` would return null even if step 4 hadn't latched.
- **`single_active_offer_fallback`:** previously masked this — there used to be only one active offer. Now there are two, so the fallback is disabled and the gap is exposed.

The system itself flagged the weakness — `conversation_mode_reasons` includes `no_strong_offer_evidence` and `weak_resolution:latest_interaction_offer` — but the offer pack injected was still Vietnam's only.

## 4. Injection diagnosis

The new Dubai trip was **never resolved**, therefore **never injected**. `offer_intelligence_injected=true` reflects the Vietnam pack only. Tamar literally has zero text about Dubai in her context for this turn, which is why she answers as if Vietnam is the only trip and pivots to budget questions instead of naming the new destination.

## 5. Publish / production state

The Dubai offer **is** in published production state — same database, `ingestion_status=ready`, `last_ingested_at` predates the failing turn by 6 minutes. This is not a publish gap. The root cause is purely in the runtime resolution logic.

## 6. Root cause + proposed fix

**Root cause (one sentence):** When the resolver finds a prior interaction's offer (step 4), it returns that offer and never broadens context, so generic browse turns ("יש יעדים נוספים?") get the sticky offer's pack instead of an awareness of the full active catalog — including the newly added Dubai trip.

### Fix plan

Single file: `src/routes/api/public/runtime/tamar-turn.ts`.

**A. Detect browse-style intent (deterministic).** Hebrew regex over the inbound message — phrases like `יעדים נוספים`, `טיולים נוספים`, `אפשרויות נוספות`, `מה יש לכם`, `איזה טיולים`, `יש משהו אחר`, `הצעות נוספות`, plus English equivalents. Return a boolean `isCatalogBrowseIntent`.

**B. Always fetch the active offer catalog once per turn.** Add a single query for all `offers` with `status='active'` and `ingestion_status='ready'`, lightweight projection (`id, title, price, currency, target_min_age, target_max_age, ai_summary, matching_tags, offer_url`). Cache the result in the local scope so resolver + injection share it.

**C. Catalog-aware injection.** In the prompt builder (around lines 740-776), when either (1) `isCatalogBrowseIntent` is true, OR (2) `conversation_mode_reasons` contains `no_strong_offer_evidence`, append a new section `Active offers catalog (use these — there are multiple options available, do NOT speak as if only one trip exists):` listing every active offer with title, short summary, price, URL, and matching tags. This is additive — the resolved offer's deep pack still goes in for offer-specific turns.

**D. Refine resolution.** In step 4, if the latest interaction is **older than N hours** (proposal: 48h) AND the current inbound looks like a catalog-browse intent, do **not** latch to that interaction — fall through to keyword match / catalog. Push `stale_interaction_skipped` to the trail for traceability.

**E. Trace fields.** Add to `active_context_layers.offer_event`:
- `catalog_injected: boolean`
- `catalog_offer_ids: string[]`
- `browse_intent_detected: boolean`

So we can verify in the Runtime Trace tab that future turns see the full catalog.

### What this fixes

- "יש יעדים נוספים?" / "טיולים נוספים?" turns will inject the Dubai trip (and any future trips) alongside Vietnam, so Tamar names them by title and price instead of pivoting to a generic budget question.
- A newly added, fully-ingested offer becomes visible to Tamar immediately on the next turn, even for contacts with a prior interaction tied to a different offer.
- No regression for offer-specific turns: when the user explicitly references one trip, the deep pack still wins.

### Out of scope (call out, not changing now)

- Reworking `intake_status` / intake mode: orthogonal to catalog visibility.
- Restructuring `interactions.related_offer_id` semantics (sticky-by-design for follow-ups).
- Embedding-based offer ranking — current keyword + catalog injection is enough for this regression.
