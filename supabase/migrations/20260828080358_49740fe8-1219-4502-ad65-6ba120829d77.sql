DROP POLICY IF EXISTS "Authenticated users manage pilot batches" ON public.pilot_batches;

REVOKE ALL ON public.pilot_batches FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_batches TO authenticated;
GRANT ALL ON public.pilot_batches TO service_role;

ALTER TABLE public.pilot_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read pilot batches"
ON public.pilot_batches FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert pilot batches"
ON public.pilot_batches FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update pilot batches"
ON public.pilot_batches FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete pilot batches"
ON public.pilot_batches FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));