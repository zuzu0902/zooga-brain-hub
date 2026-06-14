# First-class pricing contract for offers

<!-- sync-marker: force-repush 2026-06-14 to realign Git mirror with Lovable workspace (B1/B3/B4 deterministic fixes) -->

Goal: stop Tamar from saying "price not published" when the source page clearly has the price. Make pricing a typed, structured contract end-to-end — extraction → DB → runtime prompt — and reject ingestion of brand homepages that can never contain offer pricing.

## 1. Schema (new migration)

Add structured columns to `public.offers`:

- `base_price_per_person numeric` — headline per-person price
- `single_supplement numeric` — solo-room supplement
- `couple_price numeric` — couple/double price when listed separately
- `price_basis text` — e.g. `per_person_double`, `per_person_single`, `per_couple`, `total`
- `pricing_status text` — one of `published | partial | on_request | unpublished`
- `rooming_policy text` — free-form short note (e.g. "חדר זוגי, תוספת ליחיד")
- `included jsonb default '[]'` — array of strings
- `not_included jsonb default '[]'` — array of strings
- `itinerary_summary text`
- `nights integer`
- `flights_included boolean`
- `extraction_raw jsonb` — full raw model JSON for audit/replay

No new RLS table — same `offers` policies apply.

## 2. Extractor (`src/lib/offer-intelligence.functions.ts`)

- **Block bad URLs**: reject ingestion when `offer_url` host is `zooga.co` with empty path, or any URL whose path is `/`, `/home`, `/index`. Throw a clear error.
- **Headless fallback**: if stripped page text is < 600 chars OR contains no digits with currency markers (`₪|$|€|USD|EUR|ILS|דולר|שקל|אירו`), attempt Firecrawl scrape (markdown format) using `FIRECRAWL_API_KEY` if connector linked; otherwise mark `pricing_status='unpublished'` and continue with whatever was extracted.
- **Updated system prompt**: require a first-class `pricing` object:
  ```json
  "pricing": {
    "base_price_per_person": number|null,
    "single_supplement": number|null,
    "couple_price": number|null,
    "currency": "ILS|USD|EUR|null",
    "basis": "per_person_double|per_person_single|per_couple|total|null",
    "status": "published|partial|on_request|unpublished",
    "rooming_policy": string|null,
    "included": string[],
    "not_included": string[],
    "itinerary_summary": string|null,
    "nights": number|null,
    "flights_included": boolean|null
  }
  ```
  Rules in prompt: `status='published'` only if `base_price_per_person` is a real number from the page; `partial` if some pricing visible but base missing; `on_request` if page says "מחיר על פי בקשה" / "צור קשר למחיר"; `unpublished` if nothing pricing-related found. Never invent.
- **Persist** all new columns + `extraction_raw = parsed`.
- Keep existing legacy fields (`ai_summary`, `grounded_facts`, etc.) so we don't break anything.

## 3. Runtime composition (`src/lib/tamar-runtime-composition.ts`)

Add a `pricing_state` block to the L2/grounded section, branching by `offers.pricing_status`:

- `published` → inject "מחיר מאושר לציטוט: <base> <currency> לאדם בחדר זוגי. תוספת ליחיד: <single_supplement>. את יכולה לציין את המחיר ישירות."
- `partial` → "יש מידע חלקי על תמחור. ציינו <מה שיש> והפנו לאיש המכירות עבור <מה שחסר>."
- `on_request` → "המחיר נקבע אישית — הציעי שיחה עם איש המכירות."
- `unpublished` → current behavior (don't quote).

Also expose `included` / `not_included` / `rooming_policy` / `nights` / `flights_included` as a typed `pricing_facts` block instead of burying them in `grounded_facts`.

## 4. Ingestion UI

`src/routes/_app.offers.tsx` `OfferDialog.addAndAnalyze`: pre-validate that the URL host+path is not a bare brand homepage; show toast "צריך קישור עמוק לדף ההצעה (לא דף הבית)" and abort before insert.

## 5. Backfill

Not automatic. Operators re-trigger "Analyze" on existing offers from the offer detail page. Albania specifically requires the operator to update its `offer_url` to the real product page first (this is the actual fix for Albania).

## Files changed

1. **new migration** — add 12 columns to `offers`
2. `src/lib/offer-intelligence.functions.ts` — URL gate, headless fallback, new prompt, persist pricing object + raw
3. `src/lib/tamar-runtime-composition.ts` — `pricing_state` block
4. `src/routes/_app.offers.tsx` — URL pre-validation in dialog
5. `src/integrations/supabase/types.ts` — regenerated after migration approval

## Open question

Firecrawl connector — is it already linked in this workspace? If not, I'll skip the headless fallback in this round and just rely on the URL gate + improved prompt; we can add Firecrawl in a follow-up. Confirm and I'll proceed.
