CREATE OR REPLACE FUNCTION public.zooga_rotate_gateway_credential(_bearer text, _gateway_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _ok boolean;
  _n int;
BEGIN
  IF _bearer IS NULL OR length(_bearer) = 0 OR _gateway_token IS NULL OR length(_gateway_token) < 20 THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM zooga_private.control_plane_credentials
    WHERE credential_name = 'zooga_gateway_control_plane'
      AND bearer_token IS NOT NULL
      AND bearer_token = _bearer
  ) INTO _ok;
  IF NOT _ok THEN RETURN false; END IF;
  UPDATE public.zooga_core_gateway_credentials
     SET token_digest = encode(extensions.digest(_gateway_token, 'sha256'), 'hex'),
         active = true,
         rotated_at = now()
   WHERE credential_id = 'hostinger-core';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.zooga_rotate_gateway_credential(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_rotate_gateway_credential(text, text) TO service_role;