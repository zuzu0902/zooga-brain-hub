ALTER TABLE zooga_private.control_plane_credentials
  ADD COLUMN IF NOT EXISTS scheduler_token_hash text;

CREATE OR REPLACE FUNCTION public.zooga_verify_scheduler_token_hash(_candidate_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'zooga_private'
AS $$
 SELECT EXISTS(
   SELECT 1 FROM zooga_private.control_plane_credentials
   WHERE credential_name='zooga_gateway_control_plane'
     AND scheduler_token_hash IS NOT NULL
     AND scheduler_token_hash = _candidate_hash
 );
$$;

REVOKE ALL ON FUNCTION public.zooga_verify_scheduler_token_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_verify_scheduler_token_hash(text) TO service_role;