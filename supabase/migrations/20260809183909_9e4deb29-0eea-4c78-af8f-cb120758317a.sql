-- ============ 1. INBOUND EVENT VAULT (append-only) ============
CREATE TABLE public.inbound_event_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meta_whatsapp',
  provider_event_id text,
  event_type text NOT NULL DEFAULT 'unknown',
  dedupe_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  normalized_phone text,
  phone_hash text,
  processing_status text NOT NULL DEFAULT 'received',
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  processed_at timestamptz,
  contact_id uuid,
  last_error_code text,
  last_error_message text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_event_vault_status_chk CHECK (processing_status IN
    ('received','processing','processed','quarantined','dead_letter','duplicate'))
);
CREATE UNIQUE INDEX inbound_event_vault_dedupe_uniq ON public.inbound_event_vault(dedupe_key);
CREATE UNIQUE INDEX inbound_event_vault_provider_event_uniq
  ON public.inbound_event_vault(provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX inbound_event_vault_status_idx ON public.inbound_event_vault(processing_status, received_at DESC);
CREATE INDEX inbound_event_vault_phone_idx ON public.inbound_event_vault(normalized_phone);
CREATE INDEX inbound_event_vault_correlation_idx ON public.inbound_event_vault(correlation_id);

GRANT ALL ON public.inbound_event_vault TO service_role;
ALTER TABLE public.inbound_event_vault ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.zl_vault_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inbound_event_vault is append-only: DELETE is not allowed';
  END IF;
  IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'inbound_event_vault: immutable columns cannot be modified';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inbound_event_vault_append_only
  BEFORE UPDATE OR DELETE ON public.inbound_event_vault
  FOR EACH ROW EXECUTE FUNCTION public.zl_vault_append_only();

-- ============ 2. CONTACT IDENTITY REGISTRY ============
CREATE TABLE public.contact_identity_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_type text NOT NULL DEFAULT 'whatsapp',
  normalized_value text NOT NULL,
  value_hash text NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  source text,
  archived_at timestamptz,
  merged_into uuid REFERENCES public.contact_identity_registry(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_identity_type_chk CHECK (identity_type IN ('whatsapp','phone'))
);
CREATE UNIQUE INDEX contact_identity_normalized_uniq ON public.contact_identity_registry(identity_type, normalized_value);
CREATE UNIQUE INDEX contact_identity_hash_uniq ON public.contact_identity_registry(identity_type, value_hash);
CREATE INDEX contact_identity_contact_idx ON public.contact_identity_registry(contact_id);
GRANT ALL ON public.contact_identity_registry TO service_role;
ALTER TABLE public.contact_identity_registry ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER contact_identity_registry_touch BEFORE UPDATE ON public.contact_identity_registry
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.zl_identity_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'contact_identity_registry rows are never deleted; use archived_at/merged_into';
END;
$$;
CREATE TRIGGER contact_identity_registry_no_delete BEFORE DELETE ON public.contact_identity_registry
  FOR EACH ROW EXECUTE FUNCTION public.zl_identity_no_delete();

-- ============ 3. PROCESSING JOBS ============
CREATE TABLE public.processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_event_id uuid NOT NULL UNIQUE REFERENCES public.inbound_event_vault(id) ON DELETE RESTRICT,
  job_type text NOT NULL DEFAULT 'inbound_whatsapp',
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  leased_by text,
  last_error text,
  dead_letter_at timestamptz,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_jobs_state_chk CHECK (state IN ('pending','leased','succeeded','failed','dead_letter'))
);
CREATE INDEX processing_jobs_due_idx ON public.processing_jobs(state, next_attempt_at);
GRANT ALL ON public.processing_jobs TO service_role;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER processing_jobs_touch BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ 4. QUARANTINE ============
CREATE TABLE public.quarantine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_event_id uuid UNIQUE REFERENCES public.inbound_event_vault(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolution_status text NOT NULL DEFAULT 'open',
  assigned_to uuid,
  resolution_notes text,
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quarantine_severity_chk CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT quarantine_resolution_chk CHECK (resolution_status IN ('open','investigating','resolved','ignored'))
);
CREATE INDEX quarantine_events_status_idx ON public.quarantine_events(resolution_status, detected_at DESC);
GRANT ALL ON public.quarantine_events TO service_role;
ALTER TABLE public.quarantine_events ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER quarantine_events_touch BEFORE UPDATE ON public.quarantine_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ 5. OUTBOUND EVENT LEDGER / OUTBOX ============
CREATE TABLE public.outbound_event_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid,
  identity_id uuid REFERENCES public.contact_identity_registry(id) ON DELETE SET NULL,
  normalized_phone text,
  kind text NOT NULL DEFAULT 'reply',
  request_hash text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  body_preview text,
  provider_message_id text,
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  correlation_id uuid,
  vault_event_id uuid REFERENCES public.inbound_event_vault(id) ON DELETE SET NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_state_chk CHECK (state IN ('queued','sending','sent','delivered','read','failed','dead_letter','skipped'))
);
CREATE INDEX outbound_event_ledger_state_idx ON public.outbound_event_ledger(state, next_attempt_at);
CREATE INDEX outbound_event_ledger_provider_idx ON public.outbound_event_ledger(provider_message_id);
GRANT ALL ON public.outbound_event_ledger TO service_role;
ALTER TABLE public.outbound_event_ledger ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER outbound_event_ledger_touch BEFORE UPDATE ON public.outbound_event_ledger
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ 6. RECONCILIATION ============
CREATE TABLE public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  findings_count integer NOT NULL DEFAULT 0,
  repaired_count integer NOT NULL DEFAULT 0,
  error text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.reconciliation_runs TO service_role;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  finding_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  count integer NOT NULL DEFAULT 0,
  sample_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  action_taken text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_findings_run_idx ON public.reconciliation_findings(run_id);
GRANT ALL ON public.reconciliation_findings TO service_role;
ALTER TABLE public.reconciliation_findings ENABLE ROW LEVEL SECURITY;

-- ============ 7. AUDIT (append-only) ============
CREATE TABLE public.zero_loss_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_label text,
  action text NOT NULL,
  target_kind text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zero_loss_audit_log_created_idx ON public.zero_loss_audit_log(created_at DESC);
GRANT ALL ON public.zero_loss_audit_log TO service_role;
ALTER TABLE public.zero_loss_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.zl_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'zero_loss_audit_log is append-only';
END;
$$;
CREATE TRIGGER zero_loss_audit_log_append_only BEFORE UPDATE OR DELETE ON public.zero_loss_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.zl_audit_append_only();

-- ============ 8. CONTACTS: archive instead of delete ============
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE INDEX IF NOT EXISTS contacts_archived_idx ON public.contacts(archived_at);

CREATE OR REPLACE FUNCTION public.zl_contacts_delete_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('zooga.allow_contact_delete', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'contacts cannot be deleted; archive the contact instead (set archived_at)';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS contacts_delete_guard ON public.contacts;
CREATE TRIGGER contacts_delete_guard BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.zl_contacts_delete_guard();

-- ============ 9. SERVICE-ROLE PROCESSING FUNCTIONS ============
-- Durable ingest: vault row + processing job in one transaction.
CREATE OR REPLACE FUNCTION public.zl_ingest_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_dedupe_key text,
  p_raw_payload jsonb,
  p_payload_sha256 text,
  p_normalized_phone text,
  p_phone_hash text,
  p_correlation_id uuid
) RETURNS TABLE (vault_id uuid, correlation_id uuid, duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_corr uuid;
BEGIN
  INSERT INTO public.inbound_event_vault (
    provider, provider_event_id, event_type, dedupe_key, raw_payload,
    payload_sha256, normalized_phone, phone_hash, correlation_id
  ) VALUES (
    p_provider, p_provider_event_id, coalesce(p_event_type,'unknown'), p_dedupe_key, p_raw_payload,
    p_payload_sha256, p_normalized_phone, p_phone_hash, coalesce(p_correlation_id, gen_random_uuid())
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id, inbound_event_vault.correlation_id INTO v_id, v_corr;

  IF v_id IS NULL THEN
    SELECT v.id, v.correlation_id INTO v_id, v_corr
      FROM public.inbound_event_vault v WHERE v.dedupe_key = p_dedupe_key;
    RETURN QUERY SELECT v_id, v_corr, true;
    RETURN;
  END IF;

  INSERT INTO public.processing_jobs (vault_event_id, correlation_id)
  VALUES (v_id, v_corr) ON CONFLICT (vault_event_id) DO NOTHING;

  RETURN QUERY SELECT v_id, v_corr, false;
END;
$$;
REVOKE ALL ON FUNCTION public.zl_ingest_event(text,text,text,text,jsonb,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zl_ingest_event(text,text,text,text,jsonb,text,text,text,uuid) TO service_role;

-- Atomic lease claim with SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.zl_claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS TABLE (job_id uuid, vault_event_id uuid, attempts integer, max_attempts integer, correlation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM public.processing_jobs j
    WHERE j.state IN ('pending','failed','leased')
      AND j.dead_letter_at IS NULL
      AND j.attempts < j.max_attempts
      AND j.next_attempt_at <= now()
      AND (j.lease_until IS NULL OR j.lease_until < now())
    ORDER BY j.next_attempt_at ASC
    LIMIT greatest(coalesce(p_limit,10),1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.processing_jobs j
     SET state = 'leased',
         attempts = j.attempts + 1,
         leased_by = p_worker,
         lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds,120),10))
    FROM due
   WHERE j.id = due.id
  RETURNING j.id, j.vault_event_id, j.attempts, j.max_attempts, j.correlation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.zl_claim_jobs(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zl_claim_jobs(text,integer,integer) TO service_role;

-- Job completion / failure with backoff, never deletes.
CREATE OR REPLACE FUNCTION public.zl_finish_job(
  p_job_id uuid, p_success boolean, p_error text, p_backoff_seconds integer, p_contact_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault uuid;
  v_attempts integer;
  v_max integer;
BEGIN
  SELECT j.vault_event_id, j.attempts, j.max_attempts INTO v_vault, v_attempts, v_max
    FROM public.processing_jobs j WHERE j.id = p_job_id;
  IF v_vault IS NULL THEN RETURN; END IF;

  IF p_success THEN
    UPDATE public.processing_jobs SET state='succeeded', lease_until=NULL, last_error=NULL WHERE id=p_job_id;
    UPDATE public.inbound_event_vault
       SET processing_status='processed', processed_at=now(), claimed_at=NULL, claimed_by=NULL,
           attempt_count=v_attempts, contact_id=coalesce(p_contact_id, contact_id),
           last_error_code=NULL, last_error_message=NULL
     WHERE id=v_vault;
  ELSIF v_attempts >= v_max THEN
    UPDATE public.processing_jobs
       SET state='dead_letter', dead_letter_at=now(), lease_until=NULL, last_error=left(coalesce(p_error,''),500)
     WHERE id=p_job_id;
    UPDATE public.inbound_event_vault
       SET processing_status='dead_letter', attempt_count=v_attempts,
           last_error_message=left(coalesce(p_error,''),500)
     WHERE id=v_vault;
  ELSE
    UPDATE public.processing_jobs
       SET state='failed', lease_until=NULL, last_error=left(coalesce(p_error,''),500),
           next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds,30),5))
     WHERE id=p_job_id;
    UPDATE public.inbound_event_vault
       SET processing_status='received', attempt_count=v_attempts,
           next_retry_at = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds,30),5)),
           last_error_message=left(coalesce(p_error,''),500)
     WHERE id=v_vault;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.zl_finish_job(uuid,boolean,text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zl_finish_job(uuid,boolean,text,integer,uuid) TO service_role;

-- Transactional identity resolution: register the number, never lose it.
CREATE OR REPLACE FUNCTION public.zl_register_identity(
  p_normalized_value text, p_value_hash text, p_contact_id uuid, p_source text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.contact_identity_registry (identity_type, normalized_value, value_hash, contact_id, source)
  VALUES ('whatsapp', p_normalized_value, p_value_hash, p_contact_id, p_source)
  ON CONFLICT (identity_type, normalized_value) DO UPDATE
    SET last_seen_at = now(),
        contact_id = coalesce(public.contact_identity_registry.contact_id, EXCLUDED.contact_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.zl_register_identity(text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zl_register_identity(text,text,uuid,text) TO service_role;