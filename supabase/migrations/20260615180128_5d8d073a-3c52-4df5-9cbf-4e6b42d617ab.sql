DROP POLICY IF EXISTS intake_field_captures_select_authenticated ON public.intake_field_captures;
DROP POLICY IF EXISTS intake_field_captures_insert_authenticated ON public.intake_field_captures;

CREATE POLICY intake_field_captures_select_admin
  ON public.intake_field_captures
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY intake_field_captures_insert_admin
  ON public.intake_field_captures
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_field_captures TO service_role;