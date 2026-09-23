-- Agent Command Bridge: idempotency ledger, deploy-request queue, and a
-- narrowly scoped gateway-authorized contact patch RPC.

CREATE TABLE IF NOT EXISTS public.zooga_agent_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  command text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  reason text,
  target_masked text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT ON public.zooga_agent_commands TO authenticated;
GRANT ALL ON public.zooga_agent_commands TO service_role;
ALTER TABLE public.zooga_agent_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read agent commands" ON public.zooga_agent_commands;
CREATE POLICY "Admins read agent commands"
ON public.zooga_agent_commands FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.zooga_deploy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  requested_by text NOT NULL DEFAULT 'gateway:hostinger-core',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_human_publish',
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

GRANT SELECT, UPDATE ON public.zooga_deploy_requests TO authenticated;
GRANT ALL ON public.zooga_deploy_requests TO service_role;
ALTER TABLE public.zooga_deploy_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read deploy requests" ON public.zooga_deploy_requests;
CREATE POLICY "Admins read deploy requests"
ON public.zooga_deploy_requests FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins resolve deploy requests" ON public.zooga_deploy_requests;
CREATE POLICY "Admins resolve deploy requests"
ON public.zooga_deploy_requests FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Narrowly scoped contact patch. Only contacts.status and
-- contacts.conversation_state may change. Consent, opt-out, human_owned,
-- phone and roles are never touched.
CREATE OR REPLACE FUNCTION public.zooga_agent_patch_contact(
  _gateway_token text,
  _phone text,
  _status text,
  _conversation_state text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_count int;
  v_contact public.contacts%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT public.zooga_core_gateway_authorized(_gateway_token) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF _status IS NULL AND _conversation_state IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_patch');
  END IF;

  IF _status IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'contact_status' AND e.enumlabel = _status
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF _conversation_state IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'tamar_conversation_state' AND e.enumlabel = _conversation_state
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_conversation_state');
  END IF;

  v_norm := public.zooga_normalize_msisdn(_phone);
  IF v_norm IS NULL OR length(v_norm) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_phone');
  END IF;

  SELECT count(*) INTO v_count FROM public.contacts c
  WHERE public.zooga_normalize_msisdn(c.phone) = v_norm;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contact_not_found');
  ELSIF v_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_phone');
  END IF;

  SELECT * INTO v_contact FROM public.contacts c
  WHERE public.zooga_normalize_msisdn(c.phone) = v_norm;

  v_before := jsonb_build_object(
    'status', v_contact.status::text,
    'conversation_state', v_contact.conversation_state::text
  );

  UPDATE public.contacts SET
    status = COALESCE(_status::contact_status, status),
    conversation_state = COALESCE(_conversation_state::tamar_conversation_state, conversation_state)
  WHERE id = v_contact.id;

  SELECT jsonb_build_object('status', c.status::text, 'conversation_state', c.conversation_state::text)
  INTO v_after FROM public.contacts c WHERE c.id = v_contact.id;

  INSERT INTO public.tamar_admin_audit_log (actor, area, action, target_id, before_value, after_value)
  VALUES (
    'gateway:hostinger-core',
    'agent_command_bridge',
    'crm.patch_contact',
    v_contact.id::text,
    v_before,
    v_after || jsonb_build_object('reason', _reason)
  );

  RETURN jsonb_build_object('ok', true, 'changed', (v_before IS DISTINCT FROM v_after), 'before', v_before, 'after', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.zooga_agent_patch_contact(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zooga_agent_patch_contact(text, text, text, text, text) TO service_role;