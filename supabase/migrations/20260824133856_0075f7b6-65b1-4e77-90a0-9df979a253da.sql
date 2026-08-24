CREATE TABLE public.whatsapp_group_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_group_folders_conn_name_key
  ON public.whatsapp_group_folders (connection_id, lower(btrim(name)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_group_folders TO authenticated;
GRANT ALL ON public.whatsapp_group_folders TO service_role;
ALTER TABLE public.whatsapp_group_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp group folders"
  ON public.whatsapp_group_folders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.whatsapp_group_folder_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.whatsapp_group_folders(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, group_id)
);

CREATE INDEX whatsapp_group_folder_members_group_idx
  ON public.whatsapp_group_folder_members (group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_group_folder_members TO authenticated;
GRANT ALL ON public.whatsapp_group_folder_members TO service_role;
ALTER TABLE public.whatsapp_group_folder_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage whatsapp group folder members"
  ON public.whatsapp_group_folder_members FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Alex Personal (whatsapp_web_bridge + group_broadcast) only.
CREATE OR REPLACE FUNCTION public.whatsapp_group_folders_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT (transport = 'whatsapp_web_bridge' AND purpose = 'group_broadcast')
    INTO ok FROM public.whatsapp_connections WHERE id = NEW.connection_id;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'group folders are allowed only on the WhatsApp Web bridge broadcast connection';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER whatsapp_group_folders_guard_trg
  BEFORE INSERT OR UPDATE ON public.whatsapp_group_folders
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_group_folders_guard();

CREATE OR REPLACE FUNCTION public.whatsapp_group_folder_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  folder_conn uuid;
  group_conn uuid;
BEGIN
  SELECT connection_id INTO folder_conn FROM public.whatsapp_group_folders WHERE id = NEW.folder_id;
  SELECT connection_id INTO group_conn FROM public.whatsapp_groups WHERE id = NEW.group_id;
  IF folder_conn IS NULL OR group_conn IS NULL OR folder_conn <> group_conn THEN
    RAISE EXCEPTION 'folder membership must reference a group of the same bridge connection';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER whatsapp_group_folder_members_guard_trg
  BEFORE INSERT OR UPDATE ON public.whatsapp_group_folder_members
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_group_folder_members_guard();

ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS interval_seconds integer NOT NULL DEFAULT 30;