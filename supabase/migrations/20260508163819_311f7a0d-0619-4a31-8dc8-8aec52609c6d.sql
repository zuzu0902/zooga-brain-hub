
create table public.contact_memories (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null,
  memory_type text not null,
  memory_key text not null,
  memory_value text,
  confidence_score integer,
  source_message text,
  extracted_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_contact_memories_contact on public.contact_memories(contact_id);
create index idx_contact_memories_type on public.contact_memories(memory_type);

create table public.contact_profile_history (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by text not null default 'ai_extraction',
  confidence_score integer,
  source text,
  created_at timestamptz not null default now()
);
create index idx_contact_profile_history_contact on public.contact_profile_history(contact_id);
create index idx_contact_profile_history_created on public.contact_profile_history(created_at desc);

create table public.pending_ai_insights (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null,
  category text not null,
  field_name text,
  proposed_value jsonb,
  confidence_score integer,
  reasoning text,
  source_message text,
  status text not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now()
);
create index idx_pending_ai_insights_contact on public.pending_ai_insights(contact_id);
create index idx_pending_ai_insights_status on public.pending_ai_insights(status);

alter table public.contact_memories enable row level security;
alter table public.contact_profile_history enable row level security;
alter table public.pending_ai_insights enable row level security;

create policy "admins read contact_memories" on public.contact_memories for select to authenticated using (is_admin());
create policy "admins write contact_memories" on public.contact_memories for all to authenticated using (is_admin()) with check (is_admin());
create policy "public read contact_memories" on public.contact_memories for select to anon, authenticated using (true);
create policy "public write contact_memories" on public.contact_memories for all to anon, authenticated using (true) with check (true);

create policy "admins read contact_profile_history" on public.contact_profile_history for select to authenticated using (is_admin());
create policy "admins write contact_profile_history" on public.contact_profile_history for all to authenticated using (is_admin()) with check (is_admin());
create policy "public read contact_profile_history" on public.contact_profile_history for select to anon, authenticated using (true);
create policy "public write contact_profile_history" on public.contact_profile_history for all to anon, authenticated using (true) with check (true);

create policy "admins read pending_ai_insights" on public.pending_ai_insights for select to authenticated using (is_admin());
create policy "admins write pending_ai_insights" on public.pending_ai_insights for all to authenticated using (is_admin()) with check (is_admin());
create policy "public read pending_ai_insights" on public.pending_ai_insights for select to anon, authenticated using (true);
create policy "public write pending_ai_insights" on public.pending_ai_insights for all to anon, authenticated using (true) with check (true);

create trigger touch_contact_memories before update on public.contact_memories for each row execute function public.touch_updated_at();
