-- Replace tautological USING (true) / WITH CHECK (true) client policies with
-- an admin-scoped predicate. Server-side code uses the service role and is
-- unaffected. Read-only, admin-facing control-center data.

ALTER POLICY "auth read knowledge chunks" ON public.community_knowledge_chunks USING (public.is_admin());
ALTER POLICY "auth read knowledge sources" ON public.community_knowledge_sources USING (public.is_admin());

ALTER POLICY "auth manage profile facts" ON public.contact_profile_facts USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read profile facts" ON public.contact_profile_facts USING (public.is_admin());

ALTER POLICY "authenticated can read fact audit" ON public.fact_extraction_audit USING (public.is_admin());

ALTER POLICY "auth manage intake defs" ON public.intake_field_definitions USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read intake defs" ON public.intake_field_definitions USING (public.is_admin());

ALTER POLICY "authenticated read offers" ON public.offers USING (public.is_admin());
ALTER POLICY "Staff can read onboarding events" ON public.onboarding_events USING (public.is_admin());

ALTER POLICY "auth manage opening templates" ON public.opening_templates USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read opening templates" ON public.opening_templates USING (public.is_admin());

ALTER POLICY "auth manage relationship answers" ON public.relationship_intake_answers USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read relationship answers" ON public.relationship_intake_answers USING (public.is_admin());

ALTER POLICY "auth manage relationship config" ON public.relationship_intake_config USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read relationship config" ON public.relationship_intake_config USING (public.is_admin());

ALTER POLICY "auth manage relationship questions" ON public.relationship_intake_questions USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read relationship questions" ON public.relationship_intake_questions USING (public.is_admin());

ALTER POLICY "auth manage relationship state" ON public.relationship_intake_state USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read relationship state" ON public.relationship_intake_state USING (public.is_admin());

ALTER POLICY "auth read audit log" ON public.tamar_admin_audit_log USING (public.is_admin());
ALTER POLICY "agent_versions_read" ON public.tamar_agent_versions USING (public.is_admin());
ALTER POLICY "auth read brain policy" ON public.tamar_brain_policy USING (public.is_admin());
ALTER POLICY "auth read copy" ON public.tamar_copy_versions USING (public.is_admin());
ALTER POLICY "auth read decision traces" ON public.tamar_decision_traces USING (public.is_admin());
ALTER POLICY "eval_cases_read" ON public.tamar_eval_cases USING (public.is_admin());
ALTER POLICY "eval_results_read" ON public.tamar_eval_results USING (public.is_admin());
ALTER POLICY "eval_runs_read" ON public.tamar_eval_runs USING (public.is_admin());
ALTER POLICY "eval_suites_read" ON public.tamar_eval_suites USING (public.is_admin());
ALTER POLICY "flags_read" ON public.tamar_feature_flags USING (public.is_admin());
ALTER POLICY "flow_options_read" ON public.tamar_flow_options USING (public.is_admin());
ALTER POLICY "flow_steps_read" ON public.tamar_flow_steps USING (public.is_admin());
ALTER POLICY "allowlist_read" ON public.tamar_model_allowlist USING (public.is_admin());
ALTER POLICY "model_calls_read" ON public.tamar_model_calls USING (public.is_admin());
ALTER POLICY "registry_read" ON public.tamar_model_registry USING (public.is_admin());
ALTER POLICY "auth read state transitions" ON public.tamar_state_transitions USING (public.is_admin());

ALTER POLICY "auth manage voice transcripts" ON public.voice_transcripts USING (public.is_admin()) WITH CHECK (public.is_admin());
ALTER POLICY "auth read voice transcripts" ON public.voice_transcripts USING (public.is_admin());
