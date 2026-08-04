DROP POLICY IF EXISTS "auth insert audit log" ON public.tamar_admin_audit_log;
CREATE POLICY "admin insert audit log" ON public.tamar_admin_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());