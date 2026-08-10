UPDATE public.contacts
   SET intake_deferred_fields = ARRAY['interests']::text[],
       intake_last_step_id = NULL
 WHERE id = '2ade847a-2374-4401-852e-3056b4a0f194';