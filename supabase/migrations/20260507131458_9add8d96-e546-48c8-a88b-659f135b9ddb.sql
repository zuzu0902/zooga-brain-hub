
-- ===== ROLES =====
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
$$;

create policy "admins read user_roles" on public.user_roles for select to authenticated using (public.is_admin());
create policy "admins manage user_roles" on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_first_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.user_roles) = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_first_user();

-- ===== ENUMS =====
create type public.contact_status as enum ('new_lead','active_member','interested','customer','VIP','inactive');
create type public.income_range as enum ('low','medium','high','prefer_not_to_say');
create type public.spending_profile as enum ('budget','standard','premium','luxury');
create type public.price_sensitivity as enum ('high','medium','low');
create type public.gender as enum ('male','female','other','prefer_not_to_say');
create type public.contact_source as enum ('Facebook','WhatsApp','Zooga Website','Event','Tamar Bot','Manual');

create type public.interaction_type as enum (
  'facebook_message','whatsapp_message','link_click','event_interest',
  'form_submit','purchase_interest','admin_note'
);

create type public.offer_category as enum ('event','trip','party','lecture','workshop','digital_product','membership');
create type public.offer_status as enum ('draft','active','archived');

create type public.message_channel as enum ('Facebook','WhatsApp','SMS','Email');
create type public.message_status as enum ('draft','sent','failed','replied');

create type public.intake_status as enum ('pending','approved','merged','rejected');

-- ===== CONTACTS =====
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  full_name text generated always as (trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored,
  phone text unique,
  email text unique,
  facebook_id text unique,
  whatsapp_number text,

  gender public.gender,
  birth_date date,
  birthday_day int generated always as (case when birth_date is not null then extract(day from birth_date)::int end) stored,
  birthday_month int generated always as (case when birth_date is not null then extract(month from birth_date)::int end) stored,
  birthday_year int generated always as (case when birth_date is not null then extract(year from birth_date)::int end) stored,
  city text,
  region text,
  relationship_status text,

  source public.contact_source default 'Manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_interaction_at timestamptz,

  interests text[] not null default '{}',
  lifestyle_tags text[] not null default '{}',
  tags text[] not null default '{}',
  status public.contact_status not null default 'new_lead',

  income_range public.income_range,
  spending_profile public.spending_profile,
  price_sensitivity public.price_sensitivity,

  economic_score int not null default 0,
  engagement_score int not null default 0,

  consent_marketing boolean not null default false,
  consent_date timestamptz,

  notes text,

  ai_summary text,
  ai_profile_notes text,
  ai_recommended_next_action text,
  ai_offer_fit text,
  ai_risk_flags text,
  ai_confidence_score int
);
alter table public.contacts enable row level security;

create index contacts_status_idx on public.contacts(status);
create index contacts_region_idx on public.contacts(region);
create index contacts_interests_idx on public.contacts using gin(interests);
create index contacts_tags_idx on public.contacts using gin(tags);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

create policy "admins read contacts" on public.contacts for select to authenticated using (public.is_admin());
create policy "admins write contacts" on public.contacts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== INTERACTIONS =====
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  type public.interaction_type not null,
  source text,
  content text,
  related_offer_id uuid,
  related_event_id uuid,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.interactions enable row level security;
create index interactions_contact_idx on public.interactions(contact_id, timestamp desc);
create policy "admins read interactions" on public.interactions for select to authenticated using (public.is_admin());
create policy "admins write interactions" on public.interactions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.on_interaction_inserted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.contacts
    set last_interaction_at = greatest(coalesce(last_interaction_at, new.timestamp), new.timestamp),
        engagement_score = least(100, engagement_score + 2)
  where id = new.contact_id;
  return new;
end;
$$;
create trigger interactions_after_insert after insert on public.interactions
  for each row execute function public.on_interaction_inserted();

-- ===== OFFERS =====
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category public.offer_category not null,
  price numeric,
  target_interests text[] not null default '{}',
  target_region text,
  target_min_age int,
  target_max_age int,
  target_spending_profile public.spending_profile,
  status public.offer_status not null default 'draft',
  offer_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.offers enable row level security;
create trigger offers_touch before update on public.offers
  for each row execute function public.touch_updated_at();
create policy "admins read offers" on public.offers for select to authenticated using (public.is_admin());
create policy "admins write offers" on public.offers for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== MESSAGES =====
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  channel public.message_channel not null default 'Facebook',
  message_text text not null,
  status public.message_status not null default 'draft',
  sent_at timestamptz,
  reply_text text,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_contact_idx on public.messages(contact_id, created_at desc);
create policy "admins read messages" on public.messages for select to authenticated using (public.is_admin());
create policy "admins write messages" on public.messages for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== INTAKE INBOX =====
create table public.intake_inbox (
  id uuid primary key default gen_random_uuid(),
  raw_payload jsonb not null,
  parsed_name text,
  parsed_phone text,
  parsed_email text,
  parsed_facebook_id text,
  parsed_message text,
  source public.contact_source not null default 'Tamar Bot',
  status public.intake_status not null default 'pending',
  matched_contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.intake_inbox enable row level security;
create index intake_status_idx on public.intake_inbox(status, created_at desc);
create policy "admins read intake" on public.intake_inbox for select to authenticated using (public.is_admin());
create policy "admins write intake" on public.intake_inbox for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== WEBHOOK LOGS =====
create table public.webhook_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'tamar_bot',
  payload jsonb,
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now()
);
alter table public.webhook_logs enable row level security;
create index webhook_logs_created_idx on public.webhook_logs(created_at desc);
create policy "admins read webhook_logs" on public.webhook_logs for select to authenticated using (public.is_admin());
create policy "admins write webhook_logs" on public.webhook_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===== API SETTINGS =====
create table public.api_settings (
  id int primary key default 1,
  webhook_token text,
  facebook_page_id text,
  default_source public.contact_source not null default 'Tamar Bot',
  updated_at timestamptz not null default now(),
  constraint api_settings_singleton check (id = 1)
);
alter table public.api_settings enable row level security;
insert into public.api_settings (id) values (1);
create trigger api_settings_touch before update on public.api_settings
  for each row execute function public.touch_updated_at();
create policy "admins read api_settings" on public.api_settings for select to authenticated using (public.is_admin());
create policy "admins write api_settings" on public.api_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
