
-- 1) api_settings: restrict client access to non-secret columns only.
REVOKE ALL ON TABLE public.api_settings FROM anon, authenticated;

GRANT SELECT (id, facebook_page_id, default_source, tamar_backend_url, updated_at)
  ON public.api_settings TO authenticated;
GRANT UPDATE (facebook_page_id, default_source, tamar_backend_url, updated_at)
  ON public.api_settings TO authenticated;
GRANT INSERT (id, facebook_page_id, default_source, tamar_backend_url)
  ON public.api_settings TO authenticated;
GRANT ALL ON public.api_settings TO service_role;

-- 2) offers: drop unrestricted public read; keep authenticated app reads;
--    expose a narrow public view for anonymous consumers.
DROP POLICY IF EXISTS "public read offers" ON public.offers;

DROP POLICY IF EXISTS "authenticated read offers" ON public.offers;
CREATE POLICY "authenticated read offers"
  ON public.offers
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "anon read active offers" ON public.offers;
CREATE POLICY "anon read active offers"
  ON public.offers
  FOR SELECT
  TO anon
  USING (status = 'active');

CREATE OR REPLACE VIEW public.offers_public
WITH (security_invoker = true)
AS
SELECT
  id,
  title,
  description,
  category,
  status,
  price,
  currency,
  event_date,
  event_end_date,
  offer_url,
  nights,
  flights_included,
  created_at,
  updated_at
FROM public.offers
WHERE status = 'active';

GRANT SELECT ON public.offers_public TO anon, authenticated;
