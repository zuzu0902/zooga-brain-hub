ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_broadcast_targets_unique_group
  ON public.whatsapp_broadcast_targets (broadcast_id, group_id);

CREATE INDEX IF NOT EXISTS whatsapp_broadcasts_runner_idx
  ON public.whatsapp_broadcasts (status, scheduled_for);