CREATE OR REPLACE FUNCTION public.admin_reset_tamar(p_contact_id uuid, p_reason text, p_reset_intake boolean DEFAULT false, p_actor uuid DEFAULT NULL::uuid, p_correlation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_handoffs int := 0;
  v_jobs int := 0;
  v_outbox int := 0;
  v_dedupe int := 0;
  v_answers int := 0;
  v_states int := 0;
  v_captures int := 0;
  v_opted_out boolean;
  v_next_state text;
  v_corr uuid := coalesce(p_correlation, gen_random_uuid());
BEGIN
  IF p_actor IS NULL OR NOT public.has_role(p_actor, 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'reset_reason_required';
  END IF;

  SELECT to_jsonb(c) - 'raw_payloads' INTO v_before
    FROM public.contacts c WHERE c.id = p_contact_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'contact_not_found';
  END IF;

  v_opted_out := (v_before->>'opted_out_at') IS NOT NULL
                 OR (v_before->>'consent_status') = 'denied'
                 OR (v_before->>'conversation_state') = 'opted_out';

  IF v_opted_out THEN
    v_next_state := 'opted_out';
  ELSIF (v_before->>'consent_status') = 'granted' OR (v_before->>'consent_marketing')::boolean IS TRUE THEN
    v_next_state := 'consented';
  ELSE
    v_next_state := 'new_inbound';
  END IF;

  WITH h AS (
    UPDATE public.manager_handoffs
       SET status = 'resolved', resolved_at = now(),
           notes = coalesce(notes, '{}'::jsonb)
                   || jsonb_build_object('closed_by_admin_reset', left(p_reason, 200))
     WHERE contact_id = p_contact_id AND status IN ('open','notified','claimed')
     RETURNING 1
  ) SELECT count(*) INTO v_handoffs FROM h;

  WITH j AS (
    UPDATE public.processing_jobs pj
       SET state = 'dead_letter', dead_letter_at = now(), lease_until = NULL,
           leased_by = NULL, last_error = 'cancelled_by_admin_reset'
      FROM public.inbound_event_vault v
     WHERE pj.vault_event_id = v.id
       AND v.contact_id = p_contact_id
       AND pj.state IN ('pending','leased','failed')
       AND pj.dead_letter_at IS NULL
     RETURNING 1
  ) SELECT count(*) INTO v_jobs FROM j;

  WITH o AS (
    UPDATE public.outbound_event_ledger
       SET state = 'skipped', last_error = 'cancelled_by_admin_reset', updated_at = now()
     WHERE contact_id = p_contact_id AND state IN ('queued','sending')
     RETURNING 1
  ) SELECT count(*) INTO v_outbox FROM o;

  WITH d AS (
    DELETE FROM public.runtime_inbound_dedupe WHERE contact_id = p_contact_id RETURNING 1
  ) SELECT count(*) INTO v_dedupe FROM d;

  UPDATE public.contacts SET
    human_owned = false,
    human_owned_by = NULL,
    human_owned_at = NULL,
    manager_attention_required = false,
    ambiguity_turns = 0,
    last_presented_offers = NULL,
    last_presented_offers_at = NULL,
    conversation_state = v_next_state::public.tamar_conversation_state,
    conversation_state_at = now()
  WHERE id = p_contact_id;

  IF p_reset_intake THEN
    WITH a AS (DELETE FROM public.relationship_intake_answers WHERE contact_id = p_contact_id RETURNING 1)
      SELECT count(*) INTO v_answers FROM a;
    WITH s AS (DELETE FROM public.relationship_intake_state WHERE contact_id = p_contact_id RETURNING 1)
      SELECT count(*) INTO v_states FROM s;
    WITH f AS (DELETE FROM public.intake_field_captures WHERE contact_id = p_contact_id RETURNING 1)
      SELECT count(*) INTO v_captures FROM f;

    UPDATE public.campaign_contacts
       SET conversion_stage = NULL, conversation_intent = NULL
     WHERE contact_id = p_contact_id;

    UPDATE public.contacts SET
      intake_state = NULL,
      intake_stage = NULL,
      intake_status = NULL,
      intake_required_fields = NULL,
      intake_completed_fields = NULL,
      intake_missing_fields = NULL,
      intake_last_question_key = NULL,
      intake_last_question_at = NULL,
      intake_last_captured_field = NULL,
      intake_last_captured_at = NULL,
      intake_completion_score = NULL,
      intake_started_at = NULL,
      intake_completed_at = NULL,
      intake_last_step_id = NULL,
      baseline_intake_status = 'not_started',
      opening_status = NULL,
      opening_asked_at = NULL,
      opening_responded_at = NULL,
      opening_deferred_at = NULL,
      relationship_intake_status = NULL,
      relationship_intake_offered_at = NULL,
      relationship_intake_ready_at = NULL,
      relationship_intake_deferred_at = NULL,
      residence_city = NULL,
      looking_for_relationship = NULL,
      likes_travel = NULL,
      travel_scope = NULL,
      last_trip_destination = NULL
    WHERE id = p_contact_id;
  END IF;

  SELECT to_jsonb(c) - 'raw_payloads' INTO v_after FROM public.contacts c WHERE c.id = p_contact_id;

  INSERT INTO public.tamar_state_transitions (contact_id, from_state, to_state, trigger)
  VALUES (p_contact_id, v_before->>'conversation_state', v_next_state, 'admin_reset_tamar');

  INSERT INTO public.zero_loss_audit_log (actor_user_id, actor_label, action, target_kind, target_id, details)
  VALUES (p_actor, 'admin_console', 'admin_reset_tamar', 'contact', p_contact_id::text, jsonb_build_object(
    'correlation_id', v_corr,
    'reason', left(p_reason, 500),
    'reset_intake', p_reset_intake,
    'handoffs_resolved', v_handoffs,
    'jobs_cancelled', v_jobs,
    'outbox_cancelled', v_outbox,
    'dedupe_cleared', v_dedupe,
    'intake_answers_deleted', v_answers,
    'intake_states_deleted', v_states,
    'intake_captures_deleted', v_captures,
    'consent_status', v_before->>'consent_status',
    'opted_out', v_opted_out,
    'before_human_owned', (v_before->>'human_owned')::boolean,
    'before_state', v_before->>'conversation_state',
    'after_state', v_after->>'conversation_state'
  ));

  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', p_contact_id,
    'correlation_id', v_corr,
    'handoffs_resolved', v_handoffs,
    'jobs_cancelled', v_jobs,
    'outbox_cancelled', v_outbox,
    'dedupe_cleared', v_dedupe,
    'intake_reset', p_reset_intake,
    'intake_answers_deleted', v_answers,
    'intake_states_deleted', v_states,
    'intake_captures_deleted', v_captures,
    'consent_preserved', true,
    'consent_status', v_before->>'consent_status',
    'opted_out', v_opted_out,
    'locks_released', (v_before->>'human_owned')::boolean IS TRUE,
    'next_message_route', CASE WHEN v_opted_out THEN 'suppressed_opt_out' ELSE 'tamar_automation' END,
    'conversation_state', v_next_state
  );
END;
$function$;