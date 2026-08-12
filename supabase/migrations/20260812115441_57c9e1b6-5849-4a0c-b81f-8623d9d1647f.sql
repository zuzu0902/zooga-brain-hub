UPDATE public.contacts
SET whatsapp_opt_in_source = COALESCE(whatsapp_opt_in_source, 'whatsapp_button_reply'),
    whatsapp_opt_in_at = COALESCE(whatsapp_opt_in_at, timestamptz '2026-08-12 07:36:38+00'),
    whatsapp_opt_in_evidence = COALESCE(whatsapp_opt_in_evidence, 'vault:5e22c53d-b898-4201-9979-2d925fe907db')
WHERE id = '157f48cb-f5d2-4a8e-a884-cbcc4bd65980'
  AND (whatsapp_opt_in_source IS NULL OR whatsapp_opt_in_at IS NULL OR whatsapp_opt_in_evidence IS NULL);

INSERT INTO public.zero_loss_audit_log (action, actor_label, target_kind, target_id, details)
SELECT 'consent_backfill', 'admin_manual', 'contact', '157f48cb-f5d2-4a8e-a884-cbcc4bd65980',
  jsonb_build_object(
    'reason', 'explicit consent_yes button reply stored in vault',
    'evidence_vault_id', '5e22c53d-b898-4201-9979-2d925fe907db',
    'original_timestamp', '2026-08-12T07:36:38+00:00',
    'source', 'whatsapp_button_reply',
    'status_changed', false)
WHERE NOT EXISTS (
  SELECT 1 FROM public.zero_loss_audit_log
  WHERE action = 'consent_backfill' AND target_id = '157f48cb-f5d2-4a8e-a884-cbcc4bd65980');