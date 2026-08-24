-- ENUMS
CREATE TYPE public.whatsapp_transport AS ENUM ('meta_cloud_api','whatsapp_web_bridge');
CREATE TYPE public.whatsapp_connection_purpose AS ENUM ('conversation','group_broadcast');
CREATE TYPE public.whatsapp_connection_status AS ENUM ('not_configured','disconnected','connecting','connected','error');
CREATE TYPE public.whatsapp_broadcast_status AS ENUM ('draft','queued','running','completed','completed_with_errors','cancelled');
CREATE TYPE public.whatsapp_broadcast_send_mode AS ENUM ('manual','scheduled','agent');
CREATE TYPE public.whatsapp_broadcast_target_status AS ENUM ('pending','queued','sent','failed','skipped');

-- CONNECTIONS
CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  transport public.whatsapp_transport NOT NULL,
  purpose public.whatsapp_connection_purpose NOT NULL,
  status public.whatsapp_connection_status NOT NULL DEFAULT 'not_configured',
  phone_label text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  allow_agent_broadcast boolean NOT NULL DEFAULT false,
  last_connected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_connections_key_format CHECK (connection_key ~ '^[a-z0-9_]{3,64}$')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp connections" ON public.whatsapp_connections
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- no secrets may be stored in config
CREATE OR REPLACE FUNCTION public.whatsapp_connections_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF NEW.config IS NOT NULL THEN
    FOR k IN SELECT jsonb_object_keys(NEW.config) LOOP
      IF k ~* '(secret|token|password|qr|session|api_key|apikey|credential|auth)' THEN
        RAISE EXCEPTION 'secret-like key % is not allowed in whatsapp_connections.config', k;
      END IF;
    END LOOP;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $$;
CREATE TRIGGER whatsapp_connections_guard_trg BEFORE INSERT OR UPDATE ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_connections_guard();

-- GROUPS
CREATE TABLE public.whatsapp_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  whatsapp_chat_id text NOT NULL,
  current_name text NOT NULL,
  previous_name text,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  send_enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  last_name_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, whatsapp_chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_groups TO authenticated;
GRANT ALL ON public.whatsapp_groups TO service_role;
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp groups" ON public.whatsapp_groups
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER whatsapp_groups_touch BEFORE UPDATE ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- BROADCASTS
CREATE TABLE public.whatsapp_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE RESTRICT,
  title text NOT NULL,
  message_text text NOT NULL,
  media_url text,
  status public.whatsapp_broadcast_status NOT NULL DEFAULT 'draft',
  send_mode public.whatsapp_broadcast_send_mode NOT NULL DEFAULT 'manual',
  scheduled_for timestamptz,
  total_groups integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_broadcasts TO authenticated;
GRANT ALL ON public.whatsapp_broadcasts TO service_role;
ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp broadcasts" ON public.whatsapp_broadcasts
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER whatsapp_broadcasts_touch BEFORE UPDATE ON public.whatsapp_broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- only a group_broadcast / whatsapp_web_bridge connection may own a broadcast
CREATE OR REPLACE FUNCTION public.whatsapp_broadcasts_connection_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT transport, purpose INTO c FROM public.whatsapp_connections WHERE id = NEW.connection_id;
  IF c IS NULL THEN RAISE EXCEPTION 'unknown whatsapp connection'; END IF;
  IF c.purpose <> 'group_broadcast' OR c.transport <> 'whatsapp_web_bridge' THEN
    RAISE EXCEPTION 'connection is not allowed to own group broadcasts';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER whatsapp_broadcasts_connection_guard_trg BEFORE INSERT OR UPDATE OF connection_id
  ON public.whatsapp_broadcasts FOR EACH ROW EXECUTE FUNCTION public.whatsapp_broadcasts_connection_guard();

-- TARGETS
CREATE TABLE public.whatsapp_broadcast_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.whatsapp_broadcasts(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.whatsapp_groups(id) ON DELETE SET NULL,
  group_name_snapshot text NOT NULL,
  whatsapp_chat_id_snapshot text NOT NULL,
  send_order integer NOT NULL DEFAULT 0,
  status public.whatsapp_broadcast_target_status NOT NULL DEFAULT 'pending',
  error_text text,
  external_response jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, whatsapp_chat_id_snapshot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_broadcast_targets TO authenticated;
GRANT ALL ON public.whatsapp_broadcast_targets TO service_role;
ALTER TABLE public.whatsapp_broadcast_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp broadcast targets" ON public.whatsapp_broadcast_targets
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER whatsapp_broadcast_targets_touch BEFORE UPDATE ON public.whatsapp_broadcast_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SYNC LOGS
CREATE TABLE public.whatsapp_group_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  sync_type text NOT NULL DEFAULT 'groups',
  total_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  renamed_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.whatsapp_group_sync_logs TO authenticated;
GRANT ALL ON public.whatsapp_group_sync_logs TO service_role;
ALTER TABLE public.whatsapp_group_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read whatsapp sync logs" ON public.whatsapp_group_sync_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins write whatsapp sync logs" ON public.whatsapp_group_sync_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_whatsapp_groups_connection ON public.whatsapp_groups(connection_id) WHERE archived = false;
CREATE INDEX idx_whatsapp_broadcasts_status ON public.whatsapp_broadcasts(status, created_at DESC);
CREATE INDEX idx_whatsapp_broadcast_targets_broadcast ON public.whatsapp_broadcast_targets(broadcast_id, send_order);

-- SEED the two separate identities
INSERT INTO public.whatsapp_connections (connection_key, display_name, transport, purpose, status, phone_label, capabilities, enabled, config)
VALUES
  ('tamar_meta','תמר — WhatsApp Business','meta_cloud_api','conversation','connected','Tamar Business',
   ARRAY['conversations','webhooks','meta_api'], true, '{}'::jsonb),
  ('alex_personal_web','Alex Personal WhatsApp','whatsapp_web_bridge','group_broadcast','not_configured','Alex Personal',
   ARRAY['group_broadcast'], false, '{"bridge_base_url":null,"connect_path":"/connect","status_path":"/status","groups_sync_path":"/groups","broadcast_path":"/broadcast"}'::jsonb);