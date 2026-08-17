ALTER TABLE public.tamar_lite_events
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_contact_at timestamptz;

CREATE INDEX IF NOT EXISTS tamar_lite_events_pending_idx
  ON public.tamar_lite_events (processing_state, meta_timestamp);

CREATE OR REPLACE FUNCTION public.tamar_lite_attach_contact(
  p_provider_event_id text,
  p_contact_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.tamar_lite_events e
     SET contact_id = coalesce(e.contact_id, p_contact_id),
         linked_contact_at = coalesce(e.linked_contact_at, now()),
         payload = coalesce(e.payload, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb)
   WHERE e.provider_event_id = p_provider_event_id
   RETURNING e.id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tamar_lite_bump_duplicate(p_provider_event_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v int;
BEGIN
  UPDATE public.tamar_lite_events
     SET duplicate_count = duplicate_count + 1
   WHERE provider_event_id = p_provider_event_id
   RETURNING duplicate_count INTO v;
  RETURN coalesce(v, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.tamar_lite_commit_decision(
  p_event_id uuid,
  p_contact_id uuid,
  p_expected_version integer,
  p_state_before jsonb,
  p_state_after jsonb,
  p_action jsonb,
  p_facts jsonb,
  p_offer_ids text[],
  p_reason_codes text[],
  p_model_metadata jsonb,
  p_max_attempts integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_version integer := coalesce((p_state_after->>'version')::int, 0);
  v_rows integer := 0;
  v_attempts integer;
BEGIN
  IF p_contact_id IS NOT NULL THEN
    UPDATE public.tamar_lite_conversations c
       SET phase = p_state_after->>'phase',
           current_question_key = nullif(p_state_after->>'current_question_key', ''),
           version = v_next_version,
           last_inbound_wamid = nullif(p_state_after->>'last_inbound_wamid', ''),
           last_outbound_key = nullif(p_state_after->>'last_outbound_key', ''),
           human_owned = coalesce((p_state_after->>'human_owned')::boolean, false),
           updated_at = now()
     WHERE c.contact_id = p_contact_id
       AND c.version = p_expected_version;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
      BEGIN
        INSERT INTO public.tamar_lite_conversations
          (contact_id, phase, current_question_key, version, last_inbound_wamid, last_outbound_key, human_owned)
        VALUES (
          p_contact_id,
          p_state_after->>'phase',
          nullif(p_state_after->>'current_question_key', ''),
          v_next_version,
          nullif(p_state_after->>'last_inbound_wamid', ''),
          nullif(p_state_after->>'last_outbound_key', ''),
          coalesce((p_state_after->>'human_owned')::boolean, false)
        );
        v_rows := 1;
      EXCEPTION WHEN unique_violation THEN
        v_rows := 0;
      END;
    END IF;

    IF v_rows = 0 THEN
      UPDATE public.tamar_lite_events
         SET processing_state = CASE WHEN attempts + 1 >= p_max_attempts THEN 'failed' ELSE 'pending' END,
             attempts = attempts + 1,
             conflict_count = conflict_count + 1,
             error = 'optimistic_version_conflict'
       WHERE id = p_event_id
       RETURNING attempts INTO v_attempts;
      RETURN jsonb_build_object('committed', false, 'conflict', true, 'attempts', coalesce(v_attempts, 0));
    END IF;
  END IF;

  INSERT INTO public.tamar_lite_decisions
    (event_id, contact_id, state_before, state_after, action, facts, offer_ids, reason_codes, model_metadata, shadow)
  VALUES
    (p_event_id, p_contact_id, p_state_before, p_state_after, p_action, coalesce(p_facts, '{}'::jsonb),
     coalesce(p_offer_ids, '{}'), coalesce(p_reason_codes, '{}'), coalesce(p_model_metadata, '{}'::jsonb), true)
  ON CONFLICT (event_id) DO UPDATE SET
    contact_id = excluded.contact_id,
    state_before = excluded.state_before,
    state_after = excluded.state_after,
    action = excluded.action,
    facts = excluded.facts,
    offer_ids = excluded.offer_ids,
    reason_codes = excluded.reason_codes,
    model_metadata = excluded.model_metadata;

  UPDATE public.tamar_lite_events
     SET processing_state = 'processed', error = NULL
   WHERE id = p_event_id;

  RETURN jsonb_build_object('committed', true, 'conflict', false, 'version', v_next_version);
END;
$$;

REVOKE ALL ON FUNCTION public.tamar_lite_attach_contact(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tamar_lite_bump_duplicate(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text[], text[], jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tamar_lite_attach_contact(text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tamar_lite_bump_duplicate(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text[], text[], jsonb, integer) TO service_role;