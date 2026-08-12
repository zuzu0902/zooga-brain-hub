CREATE TABLE IF NOT EXISTS public.tamar_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_by uuid,
  created_by_label text,
  topic text NOT NULL,
  instruction text NOT NULL,
  offer_id uuid,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  idempotency_key text NOT NULL UNIQUE,
  preview text,
  actual_message text,
  transport text,
  provider_message_id text,
  block_reason text,
  block_reason_he text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  executed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tamar_activations_status_chk CHECK (status IN ('draft','scheduled','processing','sent','blocked','cancelled','failed'))
);

CREATE INDEX IF NOT EXISTS tamar_activations_contact_idx ON public.tamar_activations (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tamar_activations_due_idx ON public.tamar_activations (status, scheduled_at);

GRANT SELECT, INSERT, UPDATE ON public.tamar_activations TO authenticated;
GRANT ALL ON public.tamar_activations TO service_role;

ALTER TABLE public.tamar_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tamar activations"
  ON public.tamar_activations FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins write tamar activations"
  ON public.tamar_activations FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update tamar activations"
  ON public.tamar_activations FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS tamar_activations_touch ON public.tamar_activations;
CREATE TRIGGER tamar_activations_touch
  BEFORE UPDATE ON public.tamar_activations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();