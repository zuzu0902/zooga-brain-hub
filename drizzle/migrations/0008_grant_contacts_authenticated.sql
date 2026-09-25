GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;