-- Gateway-only, read-only conversation transcript export for one phone.
-- SECURITY DEFINER + explicit gateway token check; no RLS changes, no writes.

CREATE OR REPLACE FUNCTION public.zooga_normalize_msisdn(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  d text := regexp_replace(coalesce(_raw, ''), '\D', '', 'g');
BEGIN
  IF d = '' THEN RETURN NULL; END IF;
  IF left(d, 2) = '00' THEN d := substr(d, 3); END IF;
  IF left(d, 3) = '972' THEN
    d := '972' || regexp_replace(substr(d, 4), '^0+', '');
  ELSIF left(d, 1) = '0' THEN
    d := '972' || regexp_replace(substr(d, 2), '^0+', '');
  ELSIF length(d) = 9 AND left(d, 1) = '5' THEN
    d := '972' || d;
  END IF;
  IF length(d) < 8 OR length(d) > 15 THEN RETURN NULL; END IF;
  RETURN d;
END;
$function$;

CREATE OR REPLACE FUNCTION public.zooga_core_read_conversation_history(
  _gateway_token text,
  _phone text,
  _limit integer DEFAULT 50
)
RETURNS TABLE(
  direction text,
  occurred_at timestamp with time zone,
  status text,
  provider_message_id text,
  message_text text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  bounded_limit integer := greatest(1, least(coalesce(_limit, 50), 100));
  normalized text := public.zooga_normalize_msisdn(_phone);
  target_contact uuid;
BEGIN
  IF NOT public.zooga_core_gateway_authorized(_gateway_token) THEN
    RAISE EXCEPTION 'zooga_core_gateway_unauthorized' USING ERRCODE = '28000';
  END IF;
  IF normalized IS NULL THEN
    RAISE EXCEPTION 'zooga_core_invalid_phone' USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO target_contact
  FROM public.contacts c
  WHERE public.zooga_normalize_msisdn(c.whatsapp_number) = normalized
     OR public.zooga_normalize_msisdn(c.phone) = normalized
  ORDER BY c.last_interaction_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  IF target_contact IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH combined AS (
    SELECT
      'inbound'::text AS direction,
      coalesce(i.timestamp, i.created_at) AS occurred_at,
      'received'::text AS status,
      i.provider_message_id,
      i.content AS message_text
    FROM public.interactions i
    WHERE i.contact_id = target_contact
      AND i.content IS NOT NULL
      AND (i.source ILIKE 'inbound%' OR i.source ILIKE '%_inbound' OR i.source = 'tamar_inbound')
    UNION ALL
    SELECT
      'outbound'::text,
      coalesce(m.sent_at, m.created_at),
      m.status::text,
      m.provider_message_id,
      m.message_text
    FROM public.messages m
    WHERE m.contact_id = target_contact
      AND m.message_text IS NOT NULL
      AND m.status::text <> 'replied'
  )
  SELECT c.direction, c.occurred_at, c.status, c.provider_message_id, c.message_text
  FROM (
    SELECT * FROM combined ORDER BY occurred_at DESC NULLS LAST LIMIT bounded_limit
  ) c
  ORDER BY c.occurred_at ASC NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION public.zooga_core_read_conversation_history(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_core_read_conversation_history(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_normalize_msisdn(text) TO service_role;
