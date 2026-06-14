ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS base_price_per_person numeric,
  ADD COLUMN IF NOT EXISTS single_supplement numeric,
  ADD COLUMN IF NOT EXISTS couple_price numeric,
  ADD COLUMN IF NOT EXISTS price_basis text,
  ADD COLUMN IF NOT EXISTS pricing_status text,
  ADD COLUMN IF NOT EXISTS rooming_policy text,
  ADD COLUMN IF NOT EXISTS included jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS not_included jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS itinerary_summary text,
  ADD COLUMN IF NOT EXISTS nights integer,
  ADD COLUMN IF NOT EXISTS flights_included boolean,
  ADD COLUMN IF NOT EXISTS extraction_raw jsonb;

COMMENT ON COLUMN public.offers.pricing_status IS 'published | partial | on_request | unpublished';
COMMENT ON COLUMN public.offers.price_basis IS 'per_person_double | per_person_single | per_couple | total';