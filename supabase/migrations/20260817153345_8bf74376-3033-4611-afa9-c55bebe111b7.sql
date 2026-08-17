ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS catalog_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS catalog_source_hash text,
  ADD COLUMN IF NOT EXISTS catalog_analyzed_at timestamptz;

CREATE OR REPLACE VIEW public.offers_sellable AS
SELECT id, title, description, category, price, target_interests, target_region,
       target_min_age, target_max_age, target_spending_profile, status, offer_url,
       created_at, updated_at, ai_summary, grounded_facts, faq_bundle, objection_notes,
       sales_angle, matching_tags, escalation_boundary, ingestion_status, last_ingested_at,
       currency, event_date, event_end_date, base_price_per_person, single_supplement,
       couple_price, price_basis, pricing_status, rooming_policy, included, not_included,
       itinerary_summary, nights, flights_included, extraction_raw, needs_date_review,
       catalog_meta, catalog_source_hash, catalog_analyzed_at
FROM public.offers
WHERE status = 'active'::offer_status
  AND event_date IS NOT NULL
  AND event_end_date IS NOT NULL
  AND event_end_date >= now();