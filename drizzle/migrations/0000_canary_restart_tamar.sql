-- Canary restart audit ledger (service-role only; idempotency key = Meta wamid)
CREATE TABLE IF NOT EXISTS public.tamar_canary_restarts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbound_message_id text NOT NULL UNIQUE,
  phone_masked text,
  reason text NOT NULL DEFAULT 'canary_restart_phrase',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.tamar_canary_restarts TO service_role;

ALTER TABLE public.tamar_canary_restarts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read canary restarts" ON public.tamar_canary_restarts;
CREATE POLICY "Admins read canary restarts"
ON public.tamar_canary_restarts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.tamar_canary_restarts TO authenticated;

-- Narrowly scoped, durable restart for the canary contact only.
-- Constrained arguments; hard phone constraint inside the function; no UI
-- actor impersonation. Preserves consent/opt-out, message history, identity
-- records and business profile. Clears only Tamar operational state.
CREATE OR REPLACE FUNCTION public.canary_restart_tamar(
  p_phone text,
  p_inbound_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_canary constant text := '972512277533';
  v_contact_id uuid;
  v_before jsonb;
  v_next_state text;
  v_opted_out boolean;
  v_handoffs int := 0;
  v_jobs int := 0;
  v_outbox int := 0;
  v_existing uuid;
BEGIN
  IF coalesce(btrim(p_inbound_message_id), '') = '' THEN
    RAISE EXCEPTION 'inbound_message_id_required';
  END IF;

  IF v_digits <> v_canary AND v_digits <> '0512277533' AND right(v_digits, 12) <> v_canary THEN
    RAISE EXCEPTION 'not_canary_phone';
  END IF;

  SELECT id INTO v_existing
    FROM public.tamar_canary_restarts
   WHERE inbound_message_id = p_inbound_message_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'restart_id', v_existing);
  END IF;

  SELECT c.id, to_jsonb(c) - 'raw_payloads'
    INTO v_contact_id, v_before
    FROM public.contacts c
   WHERE regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_canary
      OR regexp_replace(coalesce(c.whatsapp_number, ''), '\D', '', 'g') = v_canary
   ORDER BY c.created_at ASC
   LIMIT 1
     FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contact_not_found');
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
           notes = coalesce(notes, '[]'::jsonb)
                   || jsonb_build_array(jsonb_build_object(
                        'kind', 'canary_restart', 'at', now()))
     WHERE contact_id = v_contact_id AND status IN ('open','notified','claimed')
     RETURNING 1
  ) SELECT count(*) INTO v_handoffs FROM h;

  WITH j AS (
    UPDATE public.processing_jobs pj
       SET state = 'dead_letter', dead_letter_at = now(), lease_until = NULL,
           leased_by = NULL, last_error = 'cancelled_by_canary_restart'
      FROM public.inbound_event_vault v
     WHERE pj.vault_event_id = v.id
       AND v.contact_id = v_contact_id
       AND pj.state IN ('pending','leased','failed')
       AND pj.dead_letter_at IS NULL
     RETURNING 1
  ) SELECT count(*) INTO v_jobs FROM j;

  WITH o AS (
    UPDATE public.outbound_event_ledger
       SET state = 'skipped', last_error = 'cancelled_by_canary_restart', updated_at = now()
     WHERE contact_id = v_contact_id AND state IN ('queued','sending')
     RETURNING 1
  ) SELECT count(*) INTO v_outbox FROM o;

  -- Operational state only. runtime_inbound_dedupe is deliberately NOT
  -- cleared so Meta retries of this same wamid stay idempotent.
  UPDATE public.contacts SET
    human_owned = false,
    human_owned_by = NULL,
    human_owned_at = NULL,
    manager_attention_required = false,
    ambiguity_turns = 0,
    last_presented_offers = '[]'::jsonb,
    last_presented_offers_at = NULL,
    conversation_state = v_next_state::public.tamar_conversation_state,
    conversation_state_at = now()
  WHERE id = v_contact_id;

  INSERT INTO public.tamar_state_transitions (contact_id, from_state, to_state, trigger)
  VALUES (v_contact_id, v_before->>'conversation_state', v_next_state, 'canary_restart_tamar');

  INSERT INTO public.tamar_canary_restarts (contact_id, inbound_message_id, phone_masked, reason, details)
  VALUES (
    v_contact_id,
    p_inbound_message_id,
    '***' || right(v_digits, 4),
    'canary_restart_phrase',
    jsonb_build_object(
      'handoffs_resolved', v_handoffs,
      'jobs_cancelled', v_jobs,
      'outbox_cancelled', v_outbox,
      'before_state', v_before->>'conversation_state',
      'after_state', v_next_state,
      'consent_status', v_before->>'consent_status',
      'opted_out', v_opted_out
    )
  )
  ON CONFLICT (inbound_message_id) DO NOTHING
  RETURNING id INTO v_existing;

  INSERT INTO public.zero_loss_audit_log (actor_user_id, actor_label, action, target_kind, target_id, details)
  VALUES (NULL, 'tamar_canary', 'canary_restart_tamar', 'contact', v_contact_id::text, jsonb_build_object(
    'inbound_message_id', p_inbound_message_id,
    'handoffs_resolved', v_handoffs,
    'jobs_cancelled', v_jobs,
    'outbox_cancelled', v_outbox,
    'before_state', v_before->>'conversation_state',
    'after_state', v_next_state,
    'consent_preserved', true
  ));

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'contact_id', v_contact_id,
    'handoffs_resolved', v_handoffs,
    'jobs_cancelled', v_jobs,
    'outbox_cancelled', v_outbox,
    'consent_status', v_before->>'consent_status',
    'opted_out', v_opted_out,
    'conversation_state', v_next_state
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.canary_restart_tamar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canary_restart_tamar(text, text) TO service_role;