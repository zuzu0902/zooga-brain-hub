ALTER TABLE public.tamar_lite_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text;

CREATE INDEX IF NOT EXISTS tamar_lite_events_contact_order_idx
  ON public.tamar_lite_events (contact_id, meta_timestamp, created_at, id);

-- Recover events stuck in `processing` by a crashed/restarted worker.
CREATE OR REPLACE FUNCTION public.tamar_lite_recover_stale(p_stale_seconds integer DEFAULT 300, p_max_attempts integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer := 0;
BEGIN
  WITH r AS (
    UPDATE public.tamar_lite_events e
       SET attempts = coalesce(e.attempts, 0) + 1,
           processing_state = CASE WHEN coalesce(e.attempts, 0) + 1 >= greatest(coalesce(p_max_attempts, 5), 1)
                                   THEN 'failed' ELSE 'pending' END,
           processing_started_at = NULL,
           worker_id = NULL,
           error = 'recovered_stale_processing'
     WHERE e.processing_state = 'processing'
       AND coalesce(e.processing_started_at, e.updated_at, e.created_at)
             < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 300), 30))
     RETURNING 1
  ) SELECT count(*) INTO v_count FROM r;
  RETURN v_count;
END;
$$;

-- Atomic per-contact claim: earliest pending event per contact, never a
-- contact that already has an event in flight, never a null-contact event.
CREATE OR REPLACE FUNCTION public.tamar_lite_claim_next(
  p_worker text,
  p_limit integer DEFAULT 5,
  p_stale_seconds integer DEFAULT 300,
  p_max_attempts integer DEFAULT 5
)
RETURNS SETOF public.tamar_lite_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.tamar_lite_recover_stale(p_stale_seconds, p_max_attempts);

  RETURN QUERY
  WITH cand AS (
    SELECT DISTINCT ON (e.contact_id) e.id
      FROM public.tamar_lite_events e
     WHERE e.processing_state = 'pending'
       AND e.event_kind = 'message'
       AND e.contact_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.tamar_lite_events p
          WHERE p.contact_id = e.contact_id
            AND p.processing_state = 'processing'
       )
     ORDER BY e.contact_id, e.meta_timestamp ASC NULLS FIRST, e.created_at ASC, e.id ASC
     LIMIT greatest(coalesce(p_limit, 5), 1)
  ),
  locked AS (
    SELECT l.id
      FROM public.tamar_lite_events l
      JOIN cand ON cand.id = l.id
     WHERE l.processing_state = 'pending'
       FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE public.tamar_lite_events t
     SET processing_state = 'processing',
         processing_started_at = now(),
         worker_id = p_worker,
         error = NULL
    FROM locked
   WHERE t.id = locked.id
     AND t.processing_state = 'pending'
  RETURNING t.*;
END;
$$;

DROP FUNCTION IF EXISTS public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, text[], text[], jsonb, integer);

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
  p_max_attempts integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_version integer := coalesce((p_state_after->>'version')::int, 0);
  v_rows integer := 0;
  v_attempts integer;
  v_state text;
  v_event_contact uuid;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'conflict', false, 'rejected', 'null_contact');
  END IF;

  SELECT e.processing_state, e.contact_id INTO v_state, v_event_contact
    FROM public.tamar_lite_events e WHERE e.id = p_event_id FOR UPDATE;

  IF v_state IS NULL OR v_state <> 'processing' OR v_event_contact IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object('committed', false, 'conflict', false, 'rejected', 'event_not_claimed');
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
$$;

REVOKE ALL ON FUNCTION public.tamar_lite_claim_next(text, integer, integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tamar_lite_recover_stale(integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, uuid[], text[], jsonb, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tamar_lite_claim_next(text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tamar_lite_recover_stale(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tamar_lite_commit_decision(uuid, uuid, integer, jsonb, jsonb, jsonb, jsonb, uuid[], text[], jsonb, integer) TO service_role;