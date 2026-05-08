# Zooga CRM — Premium Upgrade Plan

A large, multi-part upgrade. Webhook & phone-as-master-key behavior stays untouched. Hebrew RTL preserved.

## 1. Database migration (additive only)

Add to `public.contacts` (all nullable, safe defaults):
- `age int`, `age_range text`
- `interaction_count int default 0`
- `sales_temperature text` (cold/warm/hot)
- `purchase_intent text`, `activity_score int default 0`
- `preferred_events text[]`, `hobbies text[]`, `travel_preferences text[]`
- `favorite_activity_types text[]`, `availability_preferences text[]`
- `personality_tags text[]`, `emotional_needs text[]`
- `relationship_goals text[]`, `social_goals text[]`
- `preferred_trip_style text`, `preferred_social_style text`, `budget_sensitivity text`
- `emotional_profile text`, `communication_style text`, `social_profile text`, `sales_profile text`
- `likely_needs text[]`, `decision_triggers text[]`, `objections text[]`
- `loneliness_signal text`, `openness_score int`, `relationship_readiness text`
- `community_fit_score int`, `vip_potential text`
- `manager_attention_required boolean default false`
- `last_clicked_offer text`, `last_campaign text`
- `campaigns_received text[]`, `offers_sent text[]`
- `events_interested text[]`, `events_joined text[]`, `trips_interested text[]`
- `total_revenue numeric default 0`
- `next_best_offer text`, `recommended_campaign text`
- `dynamic_profile_fields jsonb default '{}'::jsonb`
- `raw_payloads jsonb default '[]'::jsonb`

Trigger: increment `interaction_count` on `interactions` insert (extend existing `on_interaction_inserted`).

New table `tasks`:
- id, contact_id, title, description, assigned_to, status (open/in_progress/done), due_date, priority, created_at, updated_at — public RLS like other tables.

## 2. Webhook update (`/api/public/webhook/tamar`)

Keep existing logic. Add:
- Append payload to `contacts.raw_payloads` (cap last ~50).
- Merge unknown payload keys into `dynamic_profile_fields`.
- Apply known AI fields when present (ai_summary, ai_recommended_next_action, sales_temperature, etc.).
- Continue creating contact-by-phone, inserting interaction.

## 3. Design system

Update `src/styles.css` tokens for premium SaaS look: refined neutrals, accent, success/warn/danger, subtle elevation shadows, rounded radii. Keep RTL.

## 4. Contacts list (`_app.contacts.tsx`)

Replace with professional table:
- Columns listed in spec, with badges for status / temperature / consent.
- Filter chips: status, source, region, interest (chip-multi), sales_temperature, activity score range, consent.
- Search across name/phone/city/interest.
- Row click → `/contacts/$id`.

## 5. Contact profile (`_app.contacts.$id.tsx`)

Header card: avatar initials, full_name, phone, source, status, last_interaction, consent badge, tag chips. Quick action buttons (שלח הודעה / הוסף הערה / עדכן סטטוס / פתח משימה / סמן לטיפול אישי) — actions wired to inline mutations or dialogs (note + task functional; others toggle status / flag).

Tabs (shadcn `Tabs`):
1. **סקירה כללית** — KPI cards + basic-info grid (editable inline where useful).
2. **שיחות** — interactions timeline grouped by day, role-tinted bubbles.
3. **תובנות AI** — editable cards for each AI/profile field; admin-only.
4. **פרופיל אישי** — chip editors for arrays + dynamic fields key/value list (add/remove).
5. **פעילות ומכירות** — score meters, temperature pill, lists of campaigns/offers/events, revenue.
6. **הערות ומשימות** — notes textarea + tasks CRUD.
7. **נתונים גולמיים** — collapsible JSON viewers for `raw_payloads`, latest webhook_logs by phone, dynamic_profile_fields.

## 6. Dashboard (`_app.index.tsx`)

KPI cards: total, new today, active conversations (interactions in 24h), hot leads, manager_attention_required, top interests (aggregated), recent Tamar conversations list, campaign readiness count, sales opportunities (warm+hot).

## 7. Sidebar / shell

Refine `_app.tsx` shell: cleaner sidebar header, section labels, active state, subtle dividers, RTL-correct icons.

## Out of scope
Campaign engine, payments, matching, AI generation. No webhook behavior changes beyond additive enrichment.

## Files to create/edit
- new migration
- `src/routes/api/public/webhook/tamar.ts` (extend)
- `src/routes/_app.contacts.tsx`, `_app.contacts.$id.tsx` (rewrite)
- `src/routes/_app.index.tsx` (rewrite)
- `src/routes/_app.tsx` (sidebar polish)
- `src/styles.css` (token refinement)
- `src/components/contact-profile/*` (tab components)
- `src/lib/i18n.ts` (extend labels)