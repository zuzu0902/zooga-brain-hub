INSERT INTO public.interactions (contact_id, type, source, content, provider_message_id, timestamp)
SELECT 'd6d3c85e-0906-4fc2-ae19-c3cb982efe61'::uuid,
       'whatsapp_message'::public.interaction_type,
       CASE WHEN v.event_type = 'message.interactive' THEN 'inbound_button' ELSE 'inbound_text' END,
       coalesce(
         v.raw_payload->'message'->'text'->>'body',
         v.raw_payload->'message'->'interactive'->'button_reply'->>'title',
         v.raw_payload->'message'->'interactive'->'list_reply'->>'title',
         ''),
       v.provider_event_id,
       v.created_at
FROM public.inbound_event_vault v
WHERE v.normalized_phone LIKE '%544498810'
  AND v.event_type LIKE 'message.%'
  AND v.created_at >= '2026-08-13T00:00:00Z'
  AND NOT EXISTS (
    SELECT 1 FROM public.interactions i WHERE i.provider_message_id = v.provider_event_id
  );

UPDATE public.contacts c
SET last_inbound_at = s.last_at,
    service_window_open_until = s.last_at + interval '24 hours'
FROM (
  SELECT max(v.created_at) AS last_at
  FROM public.inbound_event_vault v
  WHERE v.normalized_phone LIKE '%544498810' AND v.event_type LIKE 'message.%'
) s
WHERE c.id = 'd6d3c85e-0906-4fc2-ae19-c3cb982efe61'
  AND (c.last_inbound_at IS DISTINCT FROM s.last_at);