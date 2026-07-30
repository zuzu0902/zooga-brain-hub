-- Remove anon SELECT policy exposing internal columns on the raw offers table
DROP POLICY IF EXISTS "anon read active offers" ON public.offers;

-- Remove anon privileges on the raw table entirely
REVOKE ALL ON public.offers FROM anon;

-- Anonymous clients may only read the curated public view
GRANT SELECT ON public.offers_public TO anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.offers_public FROM anon;

-- Preserve existing access for signed-in users and backend services
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated;
GRANT ALL ON public.offers TO service_role;
GRANT SELECT ON public.offers_public TO authenticated;
GRANT ALL ON public.offers_public TO service_role;