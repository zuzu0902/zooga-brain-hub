-- ZOOGA OS SHADOW BRAIN — control/data contract. Observation only.
-- No API key is ever stored here. Disabled by default.

CREATE TABLE IF NOT EXISTS public.zooga_shadow_brain_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  model_id text NOT NULL DEFAULT 'gpt-5.6-luna',
  model_version text NOT NULL DEFAULT '2026-08-01',
  prompt_version text NOT NULL DEFAULT 'zooga_shadow_brain_v1',
  max_runs_per_cycle integer NOT NULL DEFAULT 5,
  max_output_tokens integer NOT NULL DEFAULT 180,
  request_timeout_ms integer NOT NULL DEFAULT 10000,
  daily_request_limit integer NOT NULL DEFAULT 20,
  daily_input_token_limit integer NOT NULL DEFAULT 20000,
  daily_output_token_limit integer NOT NULL DEFAULT 4000,
  daily_cost_limit_usd numeric(10,4) NOT NULL DEFAULT 0.05,
  input_cost_per_1k_usd numeric(10,6) NOT NULL DEFAULT 0.00125,
  output_cost_per_1k_usd numeric(10,6) NOT NULL DEFAULT 0.01,
  lease_seconds integer NOT NULL DEFAULT 120,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zsbc_model_id_chk CHECK (model_id ~ '^[a-z0-9._-]{2,64}$'),
  CONSTRAINT zsbc_model_version_chk CHECK (model_version ~ '^[a-z0-9._-]{1,32}$'),
  CONSTRAINT zsbc_prompt_version_chk CHECK (prompt_version ~ '^[a-z0-9._-]{1,48}$'),
  CONSTRAINT zsbc_cycle_chk CHECK (max_runs_per_cycle BETWEEN 1 AND 25),
  CONSTRAINT zsbc_out_tokens_chk CHECK (max_output_tokens BETWEEN 16 AND 512),
  CONSTRAINT zsbc_timeout_chk CHECK (request_timeout_ms BETWEEN 1000 AND 30000),
  CONSTRAINT zsbc_req_limit_chk CHECK (daily_request_limit BETWEEN 0 AND 500),
  CONSTRAINT zsbc_in_tok_limit_chk CHECK (daily_input_token_limit BETWEEN 0 AND 1000000),
  CONSTRAINT zsbc_out_tok_limit_chk CHECK (daily_output_token_limit BETWEEN 0 AND 200000),
  CONSTRAINT zsbc_cost_limit_chk CHECK (daily_cost_limit_usd >= 0 AND daily_cost_limit_usd <= 5),
  CONSTRAINT zsbc_lease_chk CHECK (lease_seconds BETWEEN 30 AND 900)
);

GRANT ALL ON public.zooga_shadow_brain_config TO service_role;
ALTER TABLE public.zooga_shadow_brain_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain config admin read" ON public.zooga_shadow_brain_config
  FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.zooga_shadow_brain_config TO authenticated;

CREATE TRIGGER zooga_shadow_brain_config_touch
  BEFORE UPDATE ON public.zooga_shadow_brain_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.zooga_shadow_brain_config (tenant_id)
SELECT t.id FROM public.tenants t WHERE t.slug = 'zooga'
ON CONFLICT (tenant_id) DO NOTHING;

-- daily accounting -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zooga_shadow_brain_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  requests integer NOT NULL DEFAULT 0,
  successes integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, usage_date)
);

GRANT ALL ON public.zooga_shadow_brain_usage TO service_role;
ALTER TABLE public.zooga_shadow_brain_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain usage admin read" ON public.zooga_shadow_brain_usage
  FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.zooga_shadow_brain_usage TO authenticated;

CREATE TRIGGER zooga_shadow_brain_usage_touch
  BEFORE UPDATE ON public.zooga_shadow_brain_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- lease bookkeeping on the existing ledger ------------------------------------
ALTER TABLE public.zooga_shadow_runs
  ADD COLUMN IF NOT EXISTS brain_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS brain_leased_by text,
  ADD COLUMN IF NOT EXISTS brain_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS brain_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS brain_max_attempts integer NOT NULL DEFAULT 3;

ALTER TABLE public.zooga_shadow_runs
  DROP CONSTRAINT IF EXISTS zooga_shadow_runs_brain_state_chk;
ALTER TABLE public.zooga_shadow_runs
  ADD CONSTRAINT zooga_shadow_runs_brain_state_chk
  CHECK (brain_state IN ('idle','leased','done','dead'));

CREATE INDEX IF NOT EXISTS zooga_shadow_runs_brain_claim_idx
  ON public.zooga_shadow_runs (tenant_id, brain_state, created_at)
  WHERE status = 'open';

-- gateway token authentication -------------------------------------------------
CREATE OR REPLACE FUNCTION zooga_private.brain_tenant(_gateway_token text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public','zooga_private','extensions'
AS $$
  SELECT t.id
  FROM public.tenants t
  JOIN zooga_private.gateway_credentials c ON c.tenant_id = t.id
  WHERE t.slug = 'zooga'
    AND c.enabled
    AND _gateway_token IS NOT NULL
    AND length(_gateway_token) >= 32
    AND c.token_hash = encode(digest(_gateway_token, 'sha256'), 'hex')
  LIMIT 1
$$;

-- claim ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zooga_brain_claim_runs(_gateway_token text, _limit integer DEFAULT NULL)
RETURNS TABLE(
  run_id uuid,
  event_id text,
  input_signals jsonb,
  canonical_action text,
  canonical_state_before text,
  canonical_state_after text,
  canonical_reason_codes text[],
  model_id text,
  model_version text,
  prompt_version text,
  max_output_tokens integer,
  request_timeout_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','zooga_private','extensions'
AS $$
DECLARE
  v_tenant uuid;
  v_cfg public.zooga_shadow_brain_config%rowtype;
  v_usage public.zooga_shadow_brain_usage%rowtype;
  v_limit integer;
  v_worker text;
BEGIN
  v_tenant := zooga_private.brain_tenant(_gateway_token);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'gateway_unauthorized' USING errcode = '42501';
  END IF;

  SELECT * INTO v_cfg FROM public.zooga_shadow_brain_config WHERE tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_cfg.enabled THEN
    RETURN;
  END IF;

  SELECT * INTO v_usage FROM public.zooga_shadow_brain_usage
   WHERE tenant_id = v_tenant AND usage_date = (now() AT TIME ZONE 'utc')::date;

  IF FOUND AND (
       v_usage.requests >= v_cfg.daily_request_limit
    OR v_usage.input_tokens >= v_cfg.daily_input_token_limit
    OR v_usage.output_tokens >= v_cfg.daily_output_token_limit
    OR v_usage.cost_usd >= v_cfg.daily_cost_limit_usd
  ) THEN
    RETURN;
  END IF;

  -- stale lease recovery
  UPDATE public.zooga_shadow_runs r
     SET brain_state = CASE WHEN r.brain_attempts >= r.brain_max_attempts THEN 'dead' ELSE 'idle' END,
         brain_leased_by = NULL,
         brain_lease_until = NULL
   WHERE r.tenant_id = v_tenant
     AND r.brain_state = 'leased'
     AND r.brain_lease_until IS NOT NULL
     AND r.brain_lease_until < now();

  v_limit := greatest(1, least(coalesce(_limit, v_cfg.max_runs_per_cycle), v_cfg.max_runs_per_cycle));
  v_limit := least(v_limit, greatest(v_cfg.daily_request_limit - coalesce(v_usage.requests, 0), 0));
  IF v_limit < 1 THEN RETURN; END IF;

  v_worker := 'gw-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  RETURN QUERY
  WITH due AS (
    SELECT r.id FROM public.zooga_shadow_runs r
     WHERE r.tenant_id = v_tenant
       AND r.status = 'open'
       AND r.eval_status = 'pending'
       AND r.brain_state = 'idle'
       AND r.brain_attempts < r.brain_max_attempts
     ORDER BY r.created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.zooga_shadow_runs r
     SET brain_state = 'leased',
         brain_leased_by = v_worker,
         brain_lease_until = now() + make_interval(secs => v_cfg.lease_seconds),
         brain_attempts = r.brain_attempts + 1
    FROM due
   WHERE r.id = due.id
  RETURNING
    r.id, r.event_id, r.input_signals,
    r.canonical_action, r.canonical_state_before, r.canonical_state_after, r.canonical_reason_codes,
    v_cfg.model_id, v_cfg.model_version, v_cfg.prompt_version,
    v_cfg.max_output_tokens, v_cfg.request_timeout_ms;
END;
$$;

-- record -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zooga_brain_record_proposal(
  _gateway_token text,
  _run_id uuid,
  _action text,
  _state_after text,
  _reason_codes text[],
  _confidence numeric,
  _model_id text,
  _model_version text,
  _latency_ms integer,
  _input_tokens integer,
  _output_tokens integer,
  _error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','zooga_private','extensions'
AS $$
DECLARE
  v_tenant uuid;
  v_cfg public.zooga_shadow_brain_config%rowtype;
  v_run public.zooga_shadow_runs%rowtype;
  v_codes text[] := '{}';
  v_code text;
  v_in integer := greatest(coalesce(_input_tokens, 0), 0);
  v_out integer := greatest(coalesce(_output_tokens, 0), 0);
  v_cost numeric(12,6);
  v_eval text;
  v_eval_codes text[] := '{}';
  v_error text;
  v_actions text[] := ARRAY['noop','ask_consent','ask_intake_question','deliver_value','recommend_offer','request_handoff','close'];
  v_states text[] := ARRAY['new_inbound','consent_pending','consented','intake_active','value_delivered','offer_recommended','human_handoff_queued','human_owned','opted_out','closed','paused'];
  v_errors text[] := ARRAY['model_error','timeout','invalid_output','rate_limited','budget_exceeded','internal_error'];
BEGIN
  v_tenant := zooga_private.brain_tenant(_gateway_token);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'gateway_unauthorized' USING errcode = '42501';
  END IF;

  SELECT * INTO v_cfg FROM public.zooga_shadow_brain_config WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error_code', 'config_unavailable'); END IF;

  SELECT * INTO v_run FROM public.zooga_shadow_runs
   WHERE id = _run_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error_code', 'run_not_found'); END IF;

  IF v_run.brain_state <> 'leased' OR v_run.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true, 'error_code', 'run_not_leased');
  END IF;

  v_error := lower(btrim(coalesce(_error_code, '')));
  IF v_error = '' THEN v_error := NULL; END IF;
  IF v_error IS NOT NULL AND NOT (v_error = ANY (v_errors)) THEN v_error := 'internal_error'; END IF;

  IF v_error IS NULL THEN
    IF _action IS NULL OR NOT (_action = ANY (v_actions))
       OR _state_after IS NULL OR NOT (_state_after = ANY (v_states))
       OR _confidence IS NULL OR _confidence < 0 OR _confidence > 1 THEN
      v_error := 'invalid_output';
    END IF;
  END IF;

  IF v_error IS NULL THEN
    FOREACH v_code IN ARRAY coalesce(_reason_codes, '{}') LOOP
      IF v_code ~ '^[a-z0-9_]{2,32}$' AND array_length(v_codes, 1) IS DISTINCT FROM 8 THEN
        v_codes := array_append(v_codes, v_code);
      END IF;
      EXIT WHEN coalesce(array_length(v_codes, 1), 0) >= 8;
    END LOOP;
  END IF;

  v_cost := round(
    (v_in::numeric / 1000) * v_cfg.input_cost_per_1k_usd
    + (v_out::numeric / 1000) * v_cfg.output_cost_per_1k_usd, 6);

  IF v_error IS NOT NULL THEN
    v_eval := 'error';
    v_eval_codes := ARRAY['error:' || v_error];
  ELSIF v_run.canonical_action IS NULL AND v_run.canonical_state_after IS NULL THEN
    v_eval := 'canonical_missing';
    v_eval_codes := ARRAY['no_canonical'];
  ELSIF lower(coalesce(v_run.canonical_action, '')) IS DISTINCT FROM lower(_action) THEN
    v_eval := 'mismatch_action';
    v_eval_codes := ARRAY['action_differs'];
  ELSIF lower(coalesce(v_run.canonical_state_after, '')) IS DISTINCT FROM lower(_state_after) THEN
    v_eval := 'mismatch_state';
    v_eval_codes := ARRAY['state_after_differs'];
  ELSIF (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(coalesce(v_run.canonical_reason_codes,'{}')) x)
        IS DISTINCT FROM (SELECT coalesce(array_agg(y ORDER BY y), '{}') FROM unnest(v_codes) y) THEN
    v_eval := 'mismatch_reason_only';
    v_eval_codes := ARRAY['reason_codes_differ'];
  ELSE
    v_eval := 'match';
  END IF;

  UPDATE public.zooga_shadow_runs
     SET proposed_action = CASE WHEN v_error IS NULL THEN _action ELSE NULL END,
         proposed_state_after = CASE WHEN v_error IS NULL THEN _state_after ELSE NULL END,
         proposed_reason_codes = v_codes,
         proposed_confidence = CASE WHEN v_error IS NULL THEN _confidence ELSE NULL END,
         provider = 'openai',
         model_id = coalesce(nullif(btrim(_model_id), ''), v_cfg.model_id),
         model_version = coalesce(nullif(btrim(_model_version), ''), v_cfg.model_version),
         latency_ms = greatest(coalesce(_latency_ms, 0), 0),
         input_tokens = v_in,
         output_tokens = v_out,
         cost_usd = v_cost,
         error_code = v_error,
         eval_status = v_eval,
         eval_reason_codes = v_eval_codes,
         evaluated_at = now(),
         status = 'finalized',
         brain_state = 'done',
         brain_leased_by = NULL,
         brain_lease_until = NULL
   WHERE id = _run_id AND tenant_id = v_tenant AND status = 'open' AND brain_state = 'leased';

  INSERT INTO public.zooga_shadow_brain_usage AS u (tenant_id, usage_date, requests, successes, errors, input_tokens, output_tokens, cost_usd)
  VALUES (v_tenant, (now() AT TIME ZONE 'utc')::date, 1,
          CASE WHEN v_error IS NULL THEN 1 ELSE 0 END,
          CASE WHEN v_error IS NULL THEN 0 ELSE 1 END,
          v_in, v_out, v_cost)
  ON CONFLICT (tenant_id, usage_date) DO UPDATE SET
    requests = u.requests + 1,
    successes = u.successes + CASE WHEN v_error IS NULL THEN 1 ELSE 0 END,
    errors = u.errors + CASE WHEN v_error IS NULL THEN 0 ELSE 1 END,
    input_tokens = u.input_tokens + v_in,
    output_tokens = u.output_tokens + v_out,
    cost_usd = u.cost_usd + v_cost;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'run_id', _run_id,
    'eval_status', v_eval, 'error_code', v_error, 'cost_usd', v_cost
  );
END;
$$;

-- release ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zooga_brain_release_run(_gateway_token text, _run_id uuid, _error_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','zooga_private','extensions'
AS $$
DECLARE
  v_tenant uuid;
  v_run public.zooga_shadow_runs%rowtype;
  v_error text;
  v_errors text[] := ARRAY['model_error','timeout','invalid_output','rate_limited','budget_exceeded','internal_error'];
  v_next text;
BEGIN
  v_tenant := zooga_private.brain_tenant(_gateway_token);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'gateway_unauthorized' USING errcode = '42501';
  END IF;

  SELECT * INTO v_run FROM public.zooga_shadow_runs
   WHERE id = _run_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error_code', 'run_not_found'); END IF;
  IF v_run.brain_state <> 'leased' THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true, 'error_code', 'run_not_leased');
  END IF;

  v_error := lower(btrim(coalesce(_error_code, '')));
  IF v_error = '' OR NOT (v_error = ANY (v_errors)) THEN v_error := 'internal_error'; END IF;

  v_next := CASE WHEN v_run.brain_attempts >= v_run.brain_max_attempts THEN 'dead' ELSE 'idle' END;

  UPDATE public.zooga_shadow_runs
     SET brain_state = v_next,
         brain_leased_by = NULL,
         brain_lease_until = NULL,
         error_code = v_error
   WHERE id = _run_id AND tenant_id = v_tenant AND brain_state = 'leased';

  RETURN jsonb_build_object('ok', true, 'brain_state', v_next, 'error_code', v_error);
END;
$$;

-- usage ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zooga_brain_usage_today(_gateway_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','zooga_private','extensions'
AS $$
DECLARE
  v_tenant uuid;
  v_cfg public.zooga_shadow_brain_config%rowtype;
  v_usage public.zooga_shadow_brain_usage%rowtype;
BEGIN
  v_tenant := zooga_private.brain_tenant(_gateway_token);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'gateway_unauthorized' USING errcode = '42501';
  END IF;

  SELECT * INTO v_cfg FROM public.zooga_shadow_brain_config WHERE tenant_id = v_tenant;
  SELECT * INTO v_usage FROM public.zooga_shadow_brain_usage
   WHERE tenant_id = v_tenant AND usage_date = (now() AT TIME ZONE 'utc')::date;

  RETURN jsonb_build_object(
    'enabled', coalesce(v_cfg.enabled, false),
    'model_id', v_cfg.model_id,
    'model_version', v_cfg.model_version,
    'prompt_version', v_cfg.prompt_version,
    'requests_today', coalesce(v_usage.requests, 0),
    'successes_today', coalesce(v_usage.successes, 0),
    'errors_today', coalesce(v_usage.errors, 0),
    'input_tokens_today', coalesce(v_usage.input_tokens, 0),
    'output_tokens_today', coalesce(v_usage.output_tokens, 0),
    'cost_usd_today', coalesce(v_usage.cost_usd, 0),
    'daily_request_limit', v_cfg.daily_request_limit,
    'daily_input_token_limit', v_cfg.daily_input_token_limit,
    'daily_output_token_limit', v_cfg.daily_output_token_limit,
    'daily_cost_limit_usd', v_cfg.daily_cost_limit_usd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zooga_brain_claim_runs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zooga_brain_record_proposal(text, uuid, text, text, text[], numeric, text, text, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zooga_brain_release_run(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zooga_brain_usage_today(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_brain_claim_runs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_brain_record_proposal(text, uuid, text, text, text[], numeric, text, text, integer, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_brain_release_run(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_brain_usage_today(text) TO service_role;