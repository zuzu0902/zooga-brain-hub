CREATE TABLE public.gateway_campaign_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  phone text NOT NULL,
  name text,
  template_name text NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  gateway_status integer,
  created_by uuid
);
GRANT SELECT, INSERT ON public.gateway_campaign_dispatches TO authenticated;
GRANT ALL ON public.gateway_campaign_dispatches TO service_role;
ALTER TABLE public.gateway_campaign_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read dispatches" ON public.gateway_campaign_dispatches FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert dispatches" ON public.gateway_campaign_dispatches FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX gateway_campaign_dispatches_dispatched_idx ON public.gateway_campaign_dispatches (dispatched_at DESC);