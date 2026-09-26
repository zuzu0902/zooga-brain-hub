CREATE OR REPLACE FUNCTION public.whatsapp_connections_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE k text;
BEGIN
  IF NEW.config IS NOT NULL THEN
    FOR k IN SELECT jsonb_object_keys(NEW.config) LOOP
      IF k ~ '^(bridge_base_url|[a-z0-9_]+_path)$' THEN CONTINUE; END IF;
      IF k ~* '(secret|token|password|qr|session|api_key|apikey|credential|auth)' THEN
        RAISE EXCEPTION 'secret-like key % is not allowed in whatsapp_connections.config', k;
      END IF;
    END LOOP;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $function$;