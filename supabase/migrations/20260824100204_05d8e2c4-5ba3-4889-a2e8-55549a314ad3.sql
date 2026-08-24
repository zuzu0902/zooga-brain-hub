CREATE TABLE public.zooga_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_kind text NOT NULL DEFAULT 'shadow_v1',
  event_id text NOT NULL,
  correlation_id text,
  canonical_decision_ref text,
  input_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash text,
  canonical_action text,
  canonical_state_before text,
  canonical_state_after text,
  canonical_reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  proposed_action text,
  proposed_state_after text,
  proposed_reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  proposed_confidence numeric,
  provider text,
  model_id text,
  model_version text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  error_code text,
  eval_status text NOT NULL DEFAULT 'pending',
  eval_reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  evaluated_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT zooga_shadow_runs_unique_event UNIQUE (tenant_id, event_id, run_kind),
  CONSTRAINT zooga_shadow_runs_eval_status_chk CHECK (eval_status IN (
    'pending','match','mismatch_action','mismatch_state','mismatch_reason_only',
    'proposal_missing','canonical_missing','error'
  )),
  CONSTRAINT zooga_shadow_runs_status_chk CHECK (status IN ('open','finalized','dead')),
  CONSTRAINT zooga_shadow_runs_signals_object_chk CHECK (jsonb_typeof(input_signals) = 'object'),
  CONSTRAINT zooga_shadow_runs_confidence_chk CHECK (proposed_confidence IS NULL OR (proposed_confidence >= 0 AND proposed_confidence <= 1)),
  CONSTRAINT zooga_shadow_runs_latency_chk CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

GRANT ALL ON public.zooga_shadow_runs TO service_role;

ALTER TABLE public.zooga_shadow_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX zooga_shadow_runs_tenant_created_idx ON public.zooga_shadow_runs (tenant_id, created_at DESC);
CREATE INDEX zooga_shadow_runs_tenant_eval_idx ON public.zooga_shadow_runs (tenant_id, eval_status);
CREATE INDEX zooga_shadow_runs_open_idx ON public.zooga_shadow_runs (tenant_id, created_at) WHERE status = 'open';
CREATE INDEX zooga_shadow_runs_expires_idx ON public.zooga_shadow_runs (expires_at);

CREATE OR REPLACE FUNCTION public.zooga_shadow_runs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('zooga.allow_shadow_run_prune', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'zooga_shadow_runs rows are retained until expiry; use zooga_shadow_runs_prune';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'finalized' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.run_kind IS DISTINCT FROM OLD.run_kind
       OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
       OR NEW.input_signals IS DISTINCT FROM OLD.input_signals
       OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
       OR NEW.canonical_action IS DISTINCT FROM OLD.canonical_action
       OR NEW.canonical_state_before IS DISTINCT FROM OLD.canonical_state_before
       OR NEW.canonical_state_after IS DISTINCT FROM OLD.canonical_state_after
       OR NEW.canonical_reason_codes IS DISTINCT FROM OLD.canonical_reason_codes
       OR NEW.eval_status IS DISTINCT FROM OLD.eval_status
       OR NEW.proposed_action IS DISTINCT FROM OLD.proposed_action
       OR NEW.proposed_state_after IS DISTINCT FROM OLD.proposed_state_after THEN
      RAISE EXCEPTION 'zooga_shadow_runs: finalized runs are immutable';
    END IF;
  END IF;

  NEW.created_at = OLD.created_at;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER zooga_shadow_runs_guard_upd
BEFORE UPDATE ON public.zooga_shadow_runs
FOR EACH ROW EXECUTE FUNCTION public.zooga_shadow_runs_guard();

CREATE TRIGGER zooga_shadow_runs_guard_del
BEFORE DELETE ON public.zooga_shadow_runs
FOR EACH ROW EXECUTE FUNCTION public.zooga_shadow_runs_guard();

CREATE OR REPLACE FUNCTION public.zooga_shadow_runs_prune(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  PERFORM set_config('zooga.allow_shadow_run_prune', 'on', true);
  WITH due AS (
    SELECT r.id FROM public.zooga_shadow_runs r
     WHERE r.expires_at < now()
     ORDER BY r.expires_at ASC
     LIMIT greatest(least(coalesce(p_limit, 200), 1000), 1)
  ), del AS (
    DELETE FROM public.zooga_shadow_runs r USING due WHERE r.id = due.id RETURNING 1
  ) SELECT count(*) INTO v_count FROM del;
  PERFORM set_config('zooga.allow_shadow_run_prune', 'off', true);
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.zooga_shadow_runs_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_shadow_runs_prune(integer) TO service_role;