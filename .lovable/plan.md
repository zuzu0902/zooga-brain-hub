## Goal
Today every price is rendered with `₪`. Trips are often priced in USD/EUR. Add a `currency` field per offer, default ILS, and surface the right symbol everywhere — including in what Tamar tells customers.

## 1. Database (migration)
- Add column `offers.currency text NOT NULL DEFAULT 'ILS'`
- Add CHECK constraint: `currency IN ('ILS','USD','EUR')`
- Backfill: the Vietnam offer (`1afaec91-4c77-4715-aceb-633f5bbe6093`) → `USD`. All others stay `ILS`.

## 2. Shared helper
Add `src/lib/currency.ts`:
- `CURRENCIES = [{code:'ILS', symbol:'₪'}, {code:'USD', symbol:'$'}, {code:'EUR', symbol:'€'}]`
- `formatPrice(price, currency)` → e.g. `₪3600`, `$3600`, `€3600` (symbol + number, per user choice)
- `currencySymbol(currency)`

## 3. UI changes (display + edit)
Replace hardcoded `₪{price}` with `formatPrice(price, currency)` in:
- `src/routes/_app.offers.tsx` (list row + create dialog)
- `src/routes/_app.offers.$id.tsx` (header badge + edit form)
- `src/routes/_app.campaigns.tsx` (offer chip)
- `src/routes/_app.campaigns.$id.tsx` (offer badge)
- `src/components/offer-picker.tsx` (selected card, list items, create dialog)

In every create/edit form, replace the single "מחיר ₪" input with a two-control row: numeric price input + currency `Select` (ILS/USD/EUR), default ILS. Persist `currency` alongside `price` in the same insert/update calls.

Extend each `supabase.from("offers").select(...)` that currently picks `price` to also pick `currency`.

## 4. Tamar runtime (so the bot says the right currency)
- `src/lib/offer-intelligence.functions.ts`: include `currency` in the select and in the prompt line (e.g. `מחיר במערכת: 3600 USD`).
- `src/routes/api/public/runtime/tamar-turn.ts`: when injecting the authoritative price line, format it with the currency symbol so Tamar's reply uses the right symbol instead of defaulting to ₪.

## 5. Out of scope
- No FX conversion. Each offer stores one currency and is displayed in that currency.
- No new currencies beyond ILS/USD/EUR (can be added later by extending the helper + CHECK constraint).
- No changes to the offer-intelligence schema (`grounded_facts`, `faq_bundle`, etc.) — currency is read directly off the offer row.

## Files touched
- new: `supabase/migrations/<timestamp>_offer_currency.sql`
- new: `src/lib/currency.ts`
- edited: `src/routes/_app.offers.tsx`, `src/routes/_app.offers.$id.tsx`, `src/routes/_app.campaigns.tsx`, `src/routes/_app.campaigns.$id.tsx`, `src/components/offer-picker.tsx`, `src/lib/offer-intelligence.functions.ts`, `src/routes/api/public/runtime/tamar-turn.ts`
- data: backfill Vietnam offer currency = USD

## Verification
- Open Vietnam offer → badge shows `$3600`, edit form shows USD selected.
- Edit a שקלים event → badge shows `₪<price>`.
- Trigger a Tamar price question on the Vietnam offer → reply includes `$3600` (or `3600 דולר`), not `₪3600`.
