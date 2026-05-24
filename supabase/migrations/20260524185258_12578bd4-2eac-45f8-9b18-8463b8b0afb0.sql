
ALTER TABLE public.pending_ai_insights
  ADD COLUMN IF NOT EXISTS resolution_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS linked_task_id uuid;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_ref_id uuid,
  ADD COLUMN IF NOT EXISTS resolution_state text NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS idx_pending_ai_insights_resolution_state ON public.pending_ai_insights(resolution_state);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON public.tasks(source_kind, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_tasks_resolution_state ON public.tasks(resolution_state);
