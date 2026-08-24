CREATE TABLE public.zooga_shadow_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  correlation_id text,
  source text NOT NULL DEFAULT 'meta',
  event_type text NOT NULL DEFAULT 'unknown',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  leased_by text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zooga_shadow_outbox_status_chk CHECK (status IN ('queued','leased','delivered','retry','dead')),
  CONSTRAINT zooga_shadow_outbox_unique_event UNIQUE (tenant_id, event_id)
);

GRANT ALL ON public.zooga_shadow_outbox TO service_role;

ALTER TABLE public.zooga_shadow_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_shadow_outbox"
ON public.zooga_shadow_outbox FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX zooga_shadow_outbox_claim_idx
  ON public.zooga_shadow_outbox (status, next_attempt_at)
  WHERE status IN ('queued','retry','leased');
CREATE INDEX zooga_shadow_outbox_tenant_status_idx
  ON public.zooga_shadow_outbox (tenant_id, status);

CREATE TRIGGER zooga_shadow_outbox_touch
  BEFORE UPDATE ON public.zooga_shadow_outbox
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.zooga_shadow_claim(p_worker text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(id uuid, event_id text, correlation_id text, source text, event_type text, occurred_at timestamptz, payload jsonb, attempts integer, max_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id FROM public.zooga_shadow_outbox o
     WHERE o.status IN ('queued','retry','leased')
       AND o.attempts < o.max_attempts
       AND o.next_attempt_at <= now()
       AND (o.lease_until IS NULL OR o.lease_until < now())
     ORDER BY o.next_attempt_at ASC
     LIMIT greatest(least(coalesce(p_limit, 10), 20), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.zooga_shadow_outbox o
     SET status = 'leased',
         attempts = o.attempts + 1,
         leased_by = p_worker,
         lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 10))
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, o.event_id, o.correlation_id, o.source, o.event_type, o.occurred_at, o.payload, o.attempts, o.max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.zooga_shadow_complete(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.zooga_shadow_outbox
     SET status = 'delivered', delivered_at = now(), lease_until = NULL,
         leased_by = NULL, last_error = NULL
   WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.zooga_shadow_fail(p_id uuid, p_error text, p_base_backoff_seconds integer DEFAULT 30)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_attempts integer; v_max integer; v_delay integer;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
    FROM public.zooga_shadow_outbox WHERE id = p_id;
  IF v_attempts IS NULL THEN RETURN; END IF;

  IF v_attempts >= v_max THEN
    UPDATE public.zooga_shadow_outbox
       SET status = 'dead', lease_until = NULL, leased_by = NULL,
           last_error = left(coalesce(p_error, ''), 300)
     WHERE id = p_id;
  ELSE
    v_delay := least(greatest(coalesce(p_base_backoff_seconds, 30), 5) * power(2, greatest(v_attempts - 1, 0))::int, 3600);
    UPDATE public.zooga_shadow_outbox
       SET status = 'retry', lease_until = NULL, leased_by = NULL,
           last_error = left(coalesce(p_error, ''), 300),
           next_attempt_at = now() + make_interval(secs => v_delay)
     WHERE id = p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.zooga_shadow_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zooga_shadow_complete(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zooga_shadow_fail(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_shadow_claim(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_shadow_complete(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zooga_shadow_fail(uuid, text, integer) TO service_role;