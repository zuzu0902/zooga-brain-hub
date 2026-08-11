REVOKE ALL ON FUNCTION public.ri_enqueue_insight_job(uuid, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ri_claim_insight_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ri_finish_insight_job(uuid, boolean, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ri_persist_insights(uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, integer, jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ri_enqueue_insight_job(uuid, text, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ri_claim_insight_jobs(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ri_finish_insight_job(uuid, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ri_persist_insights(uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, integer, jsonb, jsonb, text, text, text) TO service_role;