ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE public.interactions ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_uidx
  ON public.messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS interactions_provider_message_id_uidx
  ON public.interactions (provider_message_id) WHERE provider_message_id IS NOT NULL;