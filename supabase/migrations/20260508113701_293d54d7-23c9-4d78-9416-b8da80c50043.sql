
-- Extend contacts with premium CRM fields (additive only)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS age int,
  ADD COLUMN IF NOT EXISTS age_range text,
  ADD COLUMN IF NOT EXISTS interaction_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_temperature text,
  ADD COLUMN IF NOT EXISTS purchase_intent text,
  ADD COLUMN IF NOT EXISTS activity_score int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_events text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hobbies text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS travel_preferences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS favorite_activity_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability_preferences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS personality_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS emotional_needs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS relationship_goals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_goals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_trip_style text,
  ADD COLUMN IF NOT EXISTS preferred_social_style text,
  ADD COLUMN IF NOT EXISTS budget_sensitivity text,
  ADD COLUMN IF NOT EXISTS emotional_profile text,
  ADD COLUMN IF NOT EXISTS communication_style text,
  ADD COLUMN IF NOT EXISTS social_profile text,
  ADD COLUMN IF NOT EXISTS sales_profile text,
  ADD COLUMN IF NOT EXISTS likely_needs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS decision_triggers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS objections text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS loneliness_signal text,
  ADD COLUMN IF NOT EXISTS openness_score int,
  ADD COLUMN IF NOT EXISTS relationship_readiness text,
  ADD COLUMN IF NOT EXISTS community_fit_score int,
  ADD COLUMN IF NOT EXISTS vip_potential text,
  ADD COLUMN IF NOT EXISTS manager_attention_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_clicked_offer text,
  ADD COLUMN IF NOT EXISTS last_campaign text,
  ADD COLUMN IF NOT EXISTS campaigns_received text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS offers_sent text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS events_interested text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS events_joined text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trips_interested text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS total_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_best_offer text,
  ADD COLUMN IF NOT EXISTS recommended_campaign text,
  ADD COLUMN IF NOT EXISTS dynamic_profile_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_payloads jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Update interaction trigger to also increment interaction_count
CREATE OR REPLACE FUNCTION public.on_interaction_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update public.contacts
    set last_interaction_at = greatest(coalesce(last_interaction_at, new.timestamp), new.timestamp),
        interaction_count = coalesce(interaction_count, 0) + 1,
        engagement_score = least(100, coalesce(engagement_score, 0) + 2),
        activity_score = least(100, coalesce(activity_score, 0) + 1)
  where id = new.contact_id;
  return new;
end;
$function$;

-- Make sure trigger is attached
DROP TRIGGER IF EXISTS trg_interaction_inserted ON public.interactions;
CREATE TRIGGER trg_interaction_inserted
AFTER INSERT ON public.interactions
FOR EACH ROW EXECUTE FUNCTION public.on_interaction_inserted();

-- Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_to text,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read tasks" ON public.tasks;
CREATE POLICY "public read tasks" ON public.tasks FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public write tasks" ON public.tasks;
CREATE POLICY "public write tasks" ON public.tasks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_tasks_touch ON public.tasks;
CREATE TRIGGER trg_tasks_touch
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
