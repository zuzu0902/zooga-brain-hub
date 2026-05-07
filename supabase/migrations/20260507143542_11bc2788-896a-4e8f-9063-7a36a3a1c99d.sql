
-- Public access policies for dev mode (no auth required)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['contacts','interactions','offers','messages','intake_inbox','webhook_logs','api_settings']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "public read %I" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "public write %I" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "public read %I" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "public write %I" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
