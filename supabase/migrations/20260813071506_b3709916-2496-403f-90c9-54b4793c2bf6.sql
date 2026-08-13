UPDATE public.contacts
SET intake_last_step_id = 'interests',
    intake_stage = 'interests',
    baseline_intake_status = 'in_progress',
    intake_state = 'active'
WHERE id = 'd6d3c85e-0906-4fc2-ae19-c3cb982efe61'
  AND (city IS NOT NULL OR region IS NOT NULL)
  AND (interests IS NULL OR array_length(interests, 1) IS NULL)
  AND intake_last_step_id IS DISTINCT FROM 'interests';