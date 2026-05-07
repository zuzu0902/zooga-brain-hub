## Zooga Core CRM V1 — Build Plan

A Hebrew RTL CRM connected to Tamar Bot (Facebook webhook), built on TanStack Start + Lovable Cloud (Supabase).

### Tech & Foundations
- Enable Lovable Cloud (Postgres + Auth + server functions).
- Hebrew RTL: set `<html lang="he" dir="rtl">`, Heebo/Assistant font, warm community design tokens (cream/terracotta/sage palette in oklch), shadcn components themed accordingly.
- Admin auth: simple Supabase email/password login + `user_roles` table with `admin` role guarding all screens.

### Database Schema (English)
Tables with RLS (admin-only via `has_role`):
- `contacts` — all fields listed (basic, demographics, source, interests[], lifestyle_tags[], tags[], status enum, economic_profile, scores, consent, AI fields: ai_summary, ai_profile_notes, ai_recommended_next_action, ai_offer_fit, ai_risk_flags, ai_confidence_score, notes). Generated columns for `age`, `zodiac_sign`, `full_name`.
- `interactions` — contact_id FK, type enum, source, content, related_offer_id, related_event_id, timestamp.
- `offers` — title, description, category enum, price, target_interests[], target_region, status enum, offer_url.
- `messages` — contact_id, offer_id, channel enum, message_text, status enum, sent_at, reply_text.
- `intake_inbox` — raw_payload jsonb, parsed name/phone/facebook_id/email/message/source/timestamp, status (pending/approved/merged/rejected).
- `webhook_logs` — payload, source, status, error, created_at.
- `api_settings` — singleton row: webhook_url, api_token (hashed), facebook_page_id, default_source.
- `user_roles` + `app_role` enum + `has_role()` security definer function.

Triggers: auto-update `updated_at`, auto-recalc `engagement_score` on new interaction, auto-update `last_interaction_at`.

### Server Routes & Functions
- `POST /api/public/webhook/tamar` — verifies api_token, logs raw payload, matches contact by phone/facebook_id/email; if match → create interaction + bump last_interaction_at; if no match → create intake_inbox item.
- Server functions (auth-protected): list/get/create/update contacts, list interactions, CRUD offers, create/send messages, intake approve/merge/reject, suggest contacts for offer (matching logic), test webhook connection.

### Screens (Hebrew RTL)
1. **התחברות** — login.
2. **דשבורד** — KPIs (סה"כ אנשי קשר, לידים חדשים היום, חברים פעילים, מתעניינים, לקוחות, לא פעילים), top interests chart, recent interactions, high-engagement list.
3. **אנשי קשר** — table with search + filters (שם/טלפון/מקור/אזור/תחומי עניין/תגיות/סטטוס/ציון מעורבות/ציון כלכלי/הסכמה).
4. **פרופיל איש קשר** — tabs: פרטים, תחומי עניין ותגיות, פרופיל כלכלי, ציר זמן (interactions + messages), הצעות שנשלחו, **תובנות AI** (manual edit), הערות. Quick actions: שלח הצעה, הוסף אינטראקציה, עדכן סטטוס, הוסף תגית.
5. **תיבת קליטה** — pending intake items; approve creates contact, merge UI searches existing contacts.
6. **הצעות** — manager (event/trip/party/lecture/workshop/membership/digital_product) with target interests/region/age/spending.
7. **שליחת הצעה** — pick offer → suggested contacts list with match reason chips ("מתאים כי: מתעניין בטיולים, מאזור המרכז, פעיל לאחרונה") → select contacts → preview personalized Hebrew draft → save as draft messages (status=draft, ready for Tamar Bot integration later).
8. **הגדרות API** — webhook URL display (copy), api_token rotation, facebook_page_id, test connection button, webhook logs viewer (last 100).

### Routing (TanStack)
- `/login`
- `/_authenticated/` layout with sidebar nav
  - `/` dashboard
  - `/contacts`, `/contacts/$id`
  - `/inbox`
  - `/offers`, `/offers/$id`
  - `/send-offer`
  - `/settings/api`
- `/api/public/webhook/tamar` server route

### Matching Logic
Filter: consent=true, status≠inactive (unless override), interests overlap with offer.target_interests, region matches if set. Sort: engagement_score DESC, last_interaction_at DESC. Each candidate carries a `reasons` array rendered as chips.

### First Milestone Test
After scaffolding: send sample payload to webhook → verify intake item appears → approve in UI → contact created (no duplicate on re-send with same phone) → interaction stored.

### Out of Scope (V1)
WhatsApp scraping, autonomous AI, payments, dating engine, full automation, real Facebook send (architecture-only).

### Notes
- Design tokens warm community: bg cream, primary warm terracotta, accent sage, premium gold. All in `oklch` in `src/styles.css`.
- All UI strings Hebrew; date/number formatting `he-IL`.
- AI fields editable now; schema ready for future LLM writer.