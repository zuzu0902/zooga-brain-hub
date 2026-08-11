CREATE TABLE public.relationship_insight_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  force boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 4,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  leased_by text,
  last_error text,
  requested_by uuid,
  dead_letter_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.relationship_insight_jobs TO authenticated;
GRANT ALL ON public.relationship_insight_jobs TO service_role;

ALTER TABLE public.relationship_insight_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read insight jobs" ON public.relationship_insight_jobs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX relationship_insight_jobs_open_uniq
  ON public.relationship_insight_jobs (contact_id, source_hash)
  WHERE state IN ('pending', 'leased', 'failed');

CREATE INDEX relationship_insight_jobs_due
  ON public.relationship_insight_jobs (next_attempt_at)
  WHERE state IN ('pending', 'leased', 'failed');

CREATE TRIGGER relationship_insight_jobs_touch
  BEFORE UPDATE ON public.relationship_insight_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.ri_enqueue_insight_job(
  p_contact_id uuid,
  p_source_hash text,
  p_force boolean DEFAULT false,
  p_requested_by uuid DEFAULT NULL
) RETURNS TABLE(job_id uuid, duplicate boolean, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_state text;
BEGIN
  INSERT INTO public.relationship_insight_jobs (contact_id, source_hash, force, requested_by)
  VALUES (p_contact_id, p_source_hash, coalesce(p_force, false), p_requested_by)
  ON CONFLICT (contact_id, source_hash) WHERE state IN ('pending','leased','failed')
  DO NOTHING
  RETURNING id, relationship_insight_jobs.state INTO v_id, v_state;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false, v_state;
    RETURN;
  END IF;

  -- an open job already exists for this exact answer set
  UPDATE public.relationship_insight_jobs j
     SET force = j.force OR coalesce(p_force, false),
         next_attempt_at = CASE WHEN coalesce(p_force, false) THEN now() ELSE j.next_attempt_at END
   WHERE j.contact_id = p_contact_id
     AND j.source_hash = p_source_hash
     AND j.state IN ('pending','leased','failed')
   RETURNING j.id, j.state INTO v_id, v_state;

  RETURN QUERY SELECT v_id, true, v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.ri_claim_insight_jobs(
  p_worker text,
  p_limit integer DEFAULT 3,
  p_lease_seconds integer DEFAULT 180
) RETURNS TABLE(job_id uuid, contact_id uuid, source_hash text, force boolean, attempts integer, max_attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM public.relationship_insight_jobs j
    WHERE j.state IN ('pending','failed','leased')
      AND j.dead_letter_at IS NULL
      AND j.attempts < j.max_attempts
      AND j.next_attempt_at <= now()
      AND (j.lease_until IS NULL OR j.lease_until < now())
    ORDER BY j.next_attempt_at ASC
    LIMIT greatest(coalesce(p_limit, 3), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.relationship_insight_jobs j
     SET state = 'leased',
         attempts = j.attempts + 1,
         leased_by = p_worker,
         lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 180), 30))
    FROM due
   WHERE j.id = due.id
  RETURNING j.id, j.contact_id, j.source_hash, j.force, j.attempts, j.max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.ri_finish_insight_job(
  p_job_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_backoff_seconds integer DEFAULT 60
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_attempts integer; v_max integer;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
    FROM public.relationship_insight_jobs WHERE id = p_job_id;
  IF v_attempts IS NULL THEN RETURN; END IF;

  IF p_success THEN
    UPDATE public.relationship_insight_jobs
       SET state = 'succeeded', lease_until = NULL, leased_by = NULL, last_error = NULL
     WHERE id = p_job_id;
  ELSIF v_attempts >= v_max THEN
    UPDATE public.relationship_insight_jobs
       SET state = 'dead_letter', dead_letter_at = now(), lease_until = NULL,
           leased_by = NULL, last_error = left(coalesce(p_error, ''), 500)
     WHERE id = p_job_id;
  ELSE
    UPDATE public.relationship_insight_jobs
       SET state = 'failed', lease_until = NULL, leased_by = NULL,
           last_error = left(coalesce(p_error, ''), 500),
           next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 60), 10))
     WHERE id = p_job_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ri_persist_insights(
  p_contact_id uuid,
  p_source_hash text,
  p_status text,
  p_summary_he text,
  p_sections jsonb,
  p_matching_tags jsonb,
  p_missing_info jsonb,
  p_contradictions jsonb,
  p_confidence integer,
  p_section_confidence jsonb,
  p_answered_keys jsonb,
  p_model_id text,
  p_prompt_version text,
  p_error text
) RETURNS TABLE(version integer, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_version integer;
BEGIN
  -- serialize all version allocation / current switching for this contact
  PERFORM pg_advisory_xact_lock(hashtextextended('relationship_ai_insights', 0), hashtextextended(p_contact_id::text, 0));

  SELECT coalesce(max(i.version), 0) + 1 INTO v_version
    FROM public.relationship_ai_insights i WHERE i.contact_id = p_contact_id;

  UPDATE public.relationship_ai_insights
     SET is_current = false
   WHERE contact_id = p_contact_id AND is_current = true;

  INSERT INTO public.relationship_ai_insights AS t (
    contact_id, source_hash, version, is_current, status, summary_he, sections,
    matching_tags, missing_info, contradictions, confidence, section_confidence,
    answered_keys, model_id, prompt_version, error, generated_at
  ) VALUES (
    p_contact_id, p_source_hash, v_version, true, p_status, p_summary_he, coalesce(p_sections, '[]'::jsonb),
    coalesce(p_matching_tags, '[]'::jsonb), coalesce(p_missing_info, '[]'::jsonb),
    coalesce(p_contradictions, '[]'::jsonb), p_confidence, coalesce(p_section_confidence, '{}'::jsonb),
    coalesce(p_answered_keys, '[]'::jsonb), p_model_id, p_prompt_version, p_error, now()
  )
  ON CONFLICT (contact_id, source_hash) DO UPDATE SET
    is_current = true,
    status = excluded.status,
    summary_he = excluded.summary_he,
    sections = excluded.sections,
    matching_tags = excluded.matching_tags,
    missing_info = excluded.missing_info,
    contradictions = excluded.contradictions,
    confidence = excluded.confidence,
    section_confidence = excluded.section_confidence,
    answered_keys = excluded.answered_keys,
    model_id = excluded.model_id,
    prompt_version = excluded.prompt_version,
    error = excluded.error,
    generated_at = now()
  RETURNING t.version INTO v_version;

  RETURN QUERY SELECT v_version, p_status;
END;
$$;