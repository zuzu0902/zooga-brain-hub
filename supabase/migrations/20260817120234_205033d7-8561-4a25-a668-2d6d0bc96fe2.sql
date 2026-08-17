DO $$
DECLARE v_c uuid; v_e uuid; r1 jsonb; st text; wk text;
BEGIN
  SELECT id INTO v_c FROM public.contacts LIMIT 1;
  INSERT INTO public.tamar_lite_events(provider_event_id,event_kind,contact_id,payload,processing_state)
  VALUES ('fence-test-'||gen_random_uuid(),'message',v_c,'{}'::jsonb,'pending') RETURNING id INTO v_e;

  UPDATE public.tamar_lite_events SET processing_state='processing', worker_id='workerA', processing_started_at=now() WHERE id=v_e;
  UPDATE public.tamar_lite_events SET worker_id='workerB' WHERE id=v_e; -- reclaimed after timeout

  r1 := public.tamar_lite_commit_decision(v_e,v_c,0,'{}'::jsonb,'{"phase":"awaiting_consent","version":1}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::uuid[],'{}'::text[],'{}'::jsonb,5,'workerA');
  IF (r1->>'rejected') IS DISTINCT FROM 'lease_lost' THEN
    RAISE EXCEPTION 'FENCING FAILED: %', r1;
  END IF;

  SELECT processing_state, worker_id INTO st, wk FROM public.tamar_lite_events WHERE id=v_e;
  IF st <> 'processing' OR wk <> 'workerB' THEN
    RAISE EXCEPTION 'stale worker mutated the lease: % %', st, wk;
  END IF;

  DELETE FROM public.tamar_lite_decisions WHERE event_id = v_e;
  DELETE FROM public.tamar_lite_events WHERE id = v_e;
  RAISE NOTICE 'FENCING OK';
END $$;