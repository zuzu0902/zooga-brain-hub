## Vietnam offer fix

User-supplied values:
- price: **3600** (USD)
- offer_url: **https://zooga.biz** (unchanged — still generic root)
- description: generate via LLM summary of the Vietnam trip

### Caveat (must surface before doing this)
`https://zooga.biz` is the same generic homepage we already flagged as the root cause for weak grounded_facts / faq_bundle / sales_angle. Re-analyzing the same URL will regenerate roughly the same homepage-derived intelligence — Tamar will now state the price correctly, but trip-specific facts (dates, itinerary, what's included, flight info, etc.) will still be missing because there is no Vietnam-specific page to analyze. Recommend the user obtain the real Vietnam landing page URL before this fix delivers full quality.

### Steps

1. **Update the Vietnam offer row** (`offers` where `id = 1afaec91-4c77-4715-aceb-633f5bbe6093`) via the data-insert tool:
   - `price = 3600`
   - `description = <LLM-generated Hebrew summary>` — generated with Lovable AI (Gemini Flash) using the offer title + existing `ai_summary` as input, producing a concise 2–3 sentence Hebrew description of the Vietnam 60+ trip.
   - `offer_url` left as-is per user input.

2. **Re-run Analyze** by calling the existing `analyzeOfferIntelligence` serverFn against the offer id. This refreshes `ai_summary`, `grounded_facts`, `faq_bundle`, `objection_notes`, `sales_angle`, `matching_tags`, `escalation_boundary` from the (still generic) URL, and sets `ingestion_status=ready` with a new `last_ingested_at`.

3. **Verify** by reading the offer row back and confirming `price=3600`, new `description` present, fresh `last_ingested_at`.

4. **Retest Tamar** by posting a synthetic inbound to `/api/public/runtime/tamar-turn` (POST) with three short Hebrew prompts against the Vietnam contact/whatsapp number:
   - price question → expect Tamar to answer "3600" directly, no escalation
   - sales-page-link question → expect Tamar to send `https://zooga.biz`
   - trip-details question (e.g. dates / what's included) → expect either a grounded answer if Analyze produced it, or a graceful escalation. Report which.
   Inspect the resulting `tamar_runtime_executions` row (`runtime_mode`, `offer_id`, `inbound_message`, `outbound_reply`, `latency_ms`) to confirm grounded behavior.

### Files / surfaces touched
- DB only: `offers` row update (data, not schema). No source files edited.
- No code changes needed — analyzer + runtime are already in place.

### Deliverable
A short report containing: updated values written, Analyze result summary, the three test prompts + Tamar's actual replies, and an explicit verdict on whether the remaining quality gap is now purely the generic-URL limitation.