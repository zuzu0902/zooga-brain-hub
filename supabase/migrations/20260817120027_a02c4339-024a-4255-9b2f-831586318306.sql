-- 1) status/unknown events must never sit in the message backlog
UPDATE public.tamar_lite_events
   SET processing_state = 'recorded'
 WHERE event_kind <> 'message'
   AND processing_state = 'pending';

-- 2) lease fencing: commit must match the worker that holds the lease
DROP FUNCTION IF EXISTS public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, uuid[], text[], jsonb, integer);

CREATE OR REPLACE FUNCTION public.tamar_lite_commit_decision(
  p_event_id uuid,
  p_contact_id uuid,
  p_expected_version integer,
  p_state_before jsonb,
  p_state_after jsonb,
  p_action jsonb,
  p_facts jsonb,
  p_offer_ids uuid[],
  p_reason_codes text[],
  p_model_metadata jsonb,
  p_max_attempts integer DEFAULT 5,
  p_worker_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next_version integer := coalesce((p_state_after->>'version')::int, 0);
  v_rows integer := 0;
  v_attempts integer;
  v_state text;
  v_event_contact uuid;
  v_worker text;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'conflict', false, 'rejected', 'null_contact');
  END IF;

  SELECT e.processing_state, e.contact_id, e.worker_id
    INTO v_state, v_event_contact, v_worker
    FROM public.tamar_lite_events e WHERE e.id = p_event_id FOR UPDATE;

  IF v_state IS NULL OR v_state <> 'processing' OR v_event_contact IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object('committed', false, 'conflict', false, 'rejected', 'event_not_claimed');
  END IF;

  -- fencing: the lease must still belong to this worker
  IF p_worker_id IS NOT NULL AND v_worker IS DISTINCT FROM p_worker_id THEN
    RETURN jsonb_build_object('committed', false, 'conflict', false, 'rejected', 'lease_lost');
  END IF;

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
       SET processing_state = CASE WHEN coalesce(attempts,0) + 1 >= greatest(coalesce(p_max_attempts,5),1) THEN 'failed' ELSE 'pending' END,
           attempts = coalesce(attempts,0) + 1,
           conflict_count = coalesce(conflict_count,0) + 1,
           processing_started_at = NULL,
           worker_id = NULL,
           error = 'optimistic_version_conflict'
     WHERE id = p_event_id
     RETURNING attempts INTO v_attempts;
    RETURN jsonb_build_object('committed', false, 'conflict', true, 'attempts', coalesce(v_attempts, 0));
  END IF;

  INSERT INTO public.tamar_lite_decisions
    (event_id, contact_id, state_before, state_after, action, facts, offer_ids, reason_codes, model_metadata, shadow)
  VALUES
    (p_event_id, p_contact_id, p_state_before, p_state_after, p_action, coalesce(p_facts, '{}'::jsonb),
     coalesce(p_offer_ids, '{}'::uuid[]), coalesce(p_reason_codes, '{}'), coalesce(p_model_metadata, '{}'::jsonb), true)
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
     SET processing_state = 'processed', error = NULL,
         processing_started_at = NULL, worker_id = NULL
   WHERE id = p_event_id;

  RETURN jsonb_build_object('committed', true, 'conflict', false, 'version', v_next_version);
END;
$function$;