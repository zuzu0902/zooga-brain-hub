-- Correction to 0005: redefines zooga_core_read_migration_history identically, adding a
-- sanitized tamar_runtime_executions projection to tamar_audit_record. Content columns
-- (inbound message, reply, output text, raw payload, free-text error) are never selected.
CREATE OR REPLACE FUNCTION public.zooga_core_read_migration_history(
  _gateway_token text, _kind text, _cursor text DEFAULT NULL, _limit integer DEFAULT 50
)
RETURNS TABLE(external_ref text, source_system text, source_table text, contact_external_ref text,
  source_created_at timestamp with time zone, source_updated_at timestamp with time zone, payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  lim integer := greatest(1, least(coalesce(_limit, 50), 200));
  cur text := nullif(_cursor, '');
BEGIN
  IF NOT public.zooga_core_gateway_authorized(_gateway_token) THEN
    RAISE EXCEPTION 'zooga_core_gateway_unauthorized' USING ERRCODE = '28000';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('interaction_history', 'message_history', 'conversation_turn_history', 'task_history', 'contact_memory_history', 'contact_profile_fact_history', 'contact_profile_change_history', 'manager_handoff_history', 'organizational_knowledge_source', 'organizational_knowledge_chunk', 'tamar_audit_record') THEN
    RAISE EXCEPTION 'zooga_core_invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF _kind = 'interaction_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'interactions'::text, t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.interactions t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'message_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'messages'::text, t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.messages t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'conversation_turn_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'conversation_turns'::text, t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.conversation_turns t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'task_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'tasks'::text, t.contact_id::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.tasks t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'contact_memory_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'contact_memories'::text, t.contact_id::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.contact_memories t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'contact_profile_fact_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'contact_profile_facts'::text, t.contact_id::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.contact_profile_facts t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'contact_profile_change_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'contact_profile_history'::text, t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.contact_profile_history t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'manager_handoff_history' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'manager_handoffs'::text, t.contact_id::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.manager_handoffs t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'organizational_knowledge_source' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'community_knowledge_sources'::text, NULL::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.community_knowledge_sources t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'organizational_knowledge_chunk' THEN RETURN QUERY
    SELECT t.id::text, 'zooga_os_lovable'::text, 'community_knowledge_chunks'::text, NULL::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t))
    FROM public.community_knowledge_chunks t WHERE cur IS NULL OR t.id::text > cur ORDER BY t.id::text LIMIT lim; RETURN; END IF;
  IF _kind = 'tamar_audit_record' THEN RETURN QUERY
    WITH audit_union AS (
      SELECT ('tamar_admin_audit_log:' || t.id::text) AS ref, 'tamar_admin_audit_log'::text AS tbl, NULL::text AS cref, t.created_at AS ca, NULL::timestamptz AS ua, public.zooga_core_strip_sensitive(to_jsonb(t)) AS p FROM public.tamar_admin_audit_log t
      UNION ALL SELECT ('tamar_decision_traces:' || t.id::text), 'tamar_decision_traces', t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_decision_traces t
      UNION ALL SELECT ('tamar_state_transitions:' || t.id::text), 'tamar_state_transitions', t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_state_transitions t
      UNION ALL SELECT ('tamar_conversation_resets:' || t.id::text), 'tamar_conversation_resets', t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_conversation_resets t
      UNION ALL SELECT ('fact_extraction_audit:' || t.id::text), 'fact_extraction_audit', t.contact_id::text, t.created_at, NULL::timestamptz, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.fact_extraction_audit t
      UNION ALL SELECT ('tamar_prompt_blocks:' || t.id::text), 'tamar_prompt_blocks', NULL::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_prompt_blocks t
      UNION ALL SELECT ('tamar_agent_versions:' || t.id::text), 'tamar_agent_versions', NULL::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_agent_versions t
      UNION ALL SELECT ('tamar_copy_versions:' || t.id::text), 'tamar_copy_versions', NULL::text, t.created_at, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_copy_versions t
      UNION ALL SELECT ('tamar_brain_policy:' || t.id::text), 'tamar_brain_policy', NULL::text, NULL::timestamptz, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_brain_policy t
      UNION ALL SELECT ('tamar_behavior_settings:' || t.id::text), 'tamar_behavior_settings', NULL::text, NULL::timestamptz, t.updated_at, public.zooga_core_strip_sensitive(to_jsonb(t)) FROM public.tamar_behavior_settings t
      UNION ALL SELECT ('tamar_runtime_executions:' || r.id::text), 'tamar_runtime_executions', r.contact_id::text, r.created_at, NULL::timestamptz,
        jsonb_build_object(
          'id', r.id, 'contact_id', r.contact_id, 'created_at', r.created_at,
          'channel', r.channel, 'source', r.source, 'runtime_mode', r.runtime_mode,
          'runtime_pack_fetch_ok', r.runtime_pack_fetch_ok,
          'composition_version', r.composition_version, 'deployment_sha', r.deployment_sha,
          'tamar_settings_version_at', r.tamar_settings_version_at,
          'latency_ms', r.latency_ms, 'fallback_reason', r.fallback_reason,
          'has_error', (r.error IS NOT NULL),
          'conversation_mode', r.conversation_mode, 'conversation_mode_reasons', r.conversation_mode_reasons,
          'prompt_blocks_injected', r.prompt_blocks_injected,
          'offer_intelligence_injected', r.offer_intelligence_injected, 'offer_id', r.offer_id,
          'campaign_injected', r.campaign_injected, 'campaign_id', r.campaign_id
        )
      FROM public.tamar_runtime_executions r
    )
    SELECT a.ref, 'zooga_os_lovable'::text, a.tbl, a.cref, a.ca, a.ua, a.p FROM audit_union a
    WHERE cur IS NULL OR a.ref > cur ORDER BY a.ref LIMIT lim; RETURN; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.zooga_core_read_migration_history(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zooga_core_read_migration_history(text, text, text, integer) TO service_role;