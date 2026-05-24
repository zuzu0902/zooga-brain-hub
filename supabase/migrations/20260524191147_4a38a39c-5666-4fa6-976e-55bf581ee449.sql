
-- Tamar behavior settings (single row config)
create table if not exists public.tamar_behavior_settings (
  id integer primary key default 1,
  tone_preset text not null default 'warm-professional-hebrew',
  confidence_auto_apply_min integer not null default 75,
  confidence_pending_max integer not null default 74,
  confidence_high_min integer not null default 75,
  confidence_medium_min integer not null default 50,
  memory_write_policy text not null default 'high_confidence_or_explicit',
  memory_kinds_enabled text[] not null default array['fact','preference','warning','observation','relationship_signal','offer_signal']::text[],
  handoff_on_factual_doubt boolean not null default true,
  handoff_confidence_threshold integer not null default 60,
  handoff_keywords text[] not null default array['ביטול','החזר','תלונה','עורך דין','לא מרוצה']::text[],
  routing_mode text not null default 'proposal_first',
  routing_allow_autonomous_offers boolean not null default false,
  routing_allow_autonomous_campaigns boolean not null default false,
  sales_aggressiveness text not null default 'balanced',
  sales_max_followups_per_week integer not null default 3,
  updated_at timestamp with time zone not null default now(),
  constraint tamar_behavior_settings_singleton check (id = 1)
);

alter table public.tamar_behavior_settings enable row level security;

create policy "admins read tamar_behavior_settings"
  on public.tamar_behavior_settings for select to authenticated
  using (is_admin());

create policy "admins write tamar_behavior_settings"
  on public.tamar_behavior_settings for all to authenticated
  using (is_admin()) with check (is_admin());

create trigger tamar_behavior_settings_touch
  before update on public.tamar_behavior_settings
  for each row execute function public.touch_updated_at();

insert into public.tamar_behavior_settings (id) values (1)
  on conflict (id) do nothing;

-- AI assistant runs (persistence)
create table if not exists public.ai_assistant_runs (
  id uuid primary key default gen_random_uuid(),
  request_type text not null default 'freeform',
  prompt text not null,
  response text,
  context_used jsonb,
  model text,
  status text not null default 'pending',
  error text,
  created_by text,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone
);

create index if not exists ai_assistant_runs_created_at_idx
  on public.ai_assistant_runs (created_at desc);

alter table public.ai_assistant_runs enable row level security;

create policy "admins read ai_assistant_runs"
  on public.ai_assistant_runs for select to authenticated
  using (is_admin());

create policy "admins write ai_assistant_runs"
  on public.ai_assistant_runs for all to authenticated
  using (is_admin()) with check (is_admin());
