
CREATE TABLE public.managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.managers TO authenticated;
GRANT ALL ON public.managers TO service_role;
ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read managers" ON public.managers FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write managers" ON public.managers FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE TRIGGER managers_touch_updated_at BEFORE UPDATE ON public.managers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.manager_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid,
  customer_phone text,
  customer_name text,
  handoff_reason text,
  latest_inbound_message text,
  conversation_excerpt jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_offer_id uuid,
  resolved_campaign_id uuid,
  runtime_trace_id uuid,
  conversation_mode text,
  conversation_mode_reasons jsonb,
  status text NOT NULL DEFAULT 'open',
  manager_notified boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  notified_manager_id uuid,
  alert_payload jsonb,
  alert_response jsonb,
  alert_error text,
  claimed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_handoffs TO authenticated;
GRANT ALL ON public.manager_handoffs TO service_role;
ALTER TABLE public.manager_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read manager_handoffs" ON public.manager_handoffs FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admins write manager_handoffs" ON public.manager_handoffs FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE INDEX manager_handoffs_status_idx ON public.manager_handoffs (status, created_at DESC);
CREATE INDEX manager_handoffs_contact_idx ON public.manager_handoffs (contact_id, created_at DESC);
CREATE TRIGGER manager_handoffs_touch_updated_at BEFORE UPDATE ON public.manager_handoffs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.managers (name, phone, active, notes)
VALUES ('Alex', '+972547702620', true, 'V1 sole manager target for Tamar handoffs');
