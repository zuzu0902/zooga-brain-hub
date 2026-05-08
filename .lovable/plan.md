## Campaign Intelligence & Entry Flow — תכנית בנייה

מערכת קמפיינים מלאה שמאפשרת לתמר AI לזהות מאיזה קמפיין הגיע איש קשר ולהתאים את השיחה, האינטייק ופעולות ה-CRM באופן דינמי.

---

### 1. שכבת נתונים (Migration אחת)

**טבלה חדשה: `campaigns`**
שדות לפי הבקשה: `name, status, category, objective, description, campaign_type, source_platform, ad_copy, landing_text, images[], videos[], whatsapp_number, target_audience, target_age_ranges[], target_regions[], target_personality_types[], emotional_angle, tone_style, offer_id, intake_flow_type, faq (jsonb), objections[], prohibited_promises[], desired_conversion_action, ai_goal, ai_behavior_rules (jsonb), active_from, active_until, created_by, manager_owner_id, created_at, updated_at`.

**טבלה חדשה: `campaign_contacts`** (relationship + intelligence)
- `campaign_id, contact_id, first_touch (bool), last_touch (bool), fit_score, intent_level, emotional_engagement, conversion_probability, conversion_stage, conversation_intent, joined_at, last_activity_at`

**הוספת שדות ל-`contacts`:**
- `first_touch_campaign_id`, `last_touch_campaign_id`, `entry_offer_id`, `campaign_source`, `acquisition_source`, `conversation_intent`, `conversion_stage`

**הוספת שדה ל-`interactions`:** `campaign_id` (אופציונלי)

**Enum:** `intake_flow_type` (`trip, event, party, dating, workshop, vip, community, sales_inquiry, generic`)

RLS: כמו שאר הטבלאות (admins read/write + public לטובת תמר webhook).

---

### 2. ניהול קמפיינים — UI (Pro CRM design)

**`/campaigns`** — רשימה
- KPI top bar: קמפיינים פעילים, אנשי קשר שנרכשו השבוע, שיחות חמות, escalations.
- טבלה עם status pill, category, source_platform, owner, fit avg, conversions, daterange.
- חיפוש + פילטרים (status, platform, category).
- כפתור "קמפיין חדש".

**`/campaigns/$id`** — פרופיל קמפיין מלא בעמוד אחד ארוך (לא טאבים, בהתאם להעדפה הקודמת):
1. Header — שם, status, owner, פעיל מ/עד, אובייקטיב.
2. **Overview** — קטגוריה, מטרה, תיאור, פלטפורמה, סוג, WhatsApp number.
3. **Performance** — KPI cards: אנשי קשר, שיחות פעילות, hot leads, escalations, conversions, engagement avg, top emotional triggers.
4. **AI Behavior** — emotional_angle, tone_style, ai_goal, ai_behavior_rules (rich list), prohibited_promises, FAQ, objections.
5. **Offer Association** — קישור ל-offer + intake_flow_type + desired_conversion_action.
6. **Intake Flow** — תצוגה של השאלות שתמר תשאל בזרימה הנבחרת (preview).
7. **Target Audience** — audience, age ranges, regions, personality types.
8. **Related Contacts** — טבלה עם fit_score, intent, stage, last activity, link לפרופיל.
9. **Related Conversations** — interactions אחרונות תחת הקמפיין.
10. **Escalations** — אנשי קשר שדורשים manager_attention_required מהקמפיין.

**`/campaigns/new`** + edit — דיאלוג/עמוד טופס עשיר עם sections, validation בזוד.

עיצוב: כרטיסים, section headings (כמו ה-`SectionHeading` שכבר קיים בפרופיל איש קשר), status badges, טבלאות נקיות, RTL.

---

### 3. Dynamic Intake Engine

**`src/lib/intake-flows.ts`** — מילון של flows:
```
trip       → ["יעד מעניין", "תקציב", "תאריכים", "עם מי", "סגנון טיול"]
event      → ["סוג אירוע", "אזור", "תאריך", "כמות אנשים"]
party      → ["סגנון", "אזור", "גיל", "סולו/חברים"]
dating     → ["מצב משפחתי", "מה מחפש", "טווח גילים"]
workshop   → ["נושא", "ניסיון קודם", "זמינות"]
vip        → ["תקציב גבוה", "סוג חוויה", "פרטיות"]
community  → ["תחומי עניין", "אזור", "תדירות"]
sales_inquiry → ["מה ראה", "התנגדויות", "טווח זמן"]
generic    → fallback
```
כל flow מחזיר רשימת שאלות + system prompt addendum.

---

### 4. Tamar Webhook — שדרוג

**`src/routes/api/public/webhook/tamar.ts`:**
- בקבלת הודעה: זהה קמפיין דרך `campaign_id` ב-payload, או דרך `whatsapp_number` של הקמפיין, או utm/keyword בהודעה הראשונה.
- אם נמצא: צור/עדכן `campaign_contacts` row, עדכן `first_touch_campaign_id` (אם null), תמיד עדכן `last_touch_campaign_id`, רשום `interaction.campaign_id`.
- בנה **AI Campaign Context** (server function) שמחזיר block טקסט עם: campaign goal, tone, offer, objections, emotional angle, FAQ, audience, escalation rules, intake flow questions, opening message suggestion.
- הוסף לתשובה ל-Tamar Bot שדה `campaign_context` + `suggested_opening` + `intake_flow_type` + `should_escalate`.

**Server function: `getCampaignContext(campaignId)`** — מחזיר את ה-block המוכן.

**AI Safety:** אם אין מידע בטוח על שאלה → `should_escalate: true` + הודעה למנהל (manager_attention_required=true).

---

### 5. Campaign Matching Intelligence

**Server function `scoreCampaignFit(contactId, campaignId)`** — משתמש ב-Lovable AI (gemini-2.5-flash) עם פרומפט שמקבל פרופיל + קמפיין ומחזיר JSON: `{fit_score, intent_level, emotional_engagement, conversion_probability, reasoning}`.
נקרא אוטומטית מה-webhook אחרי כמה אינטראקציות, ומה-UI ידנית בכפתור "Re-score".

---

### 6. Performance Dashboard

`/campaigns` top bar + per-campaign performance section משתמשים באגרגציות:
- contacts_acquired = count(campaign_contacts)
- active_conversations = count(interactions in last 7d)
- hot_leads = count where intent_level >= 'high'
- escalations = count where manager_attention_required
- conversions = count where conversion_stage = 'converted'
- avg engagement, top triggers (group by emotional_angle).

מחושב ב-server function `getCampaignStats`.

---

### 7. Navigation

הוספת "קמפיינים" ל-`_app.tsx` sidebar עם אייקון Megaphone.

---

### Technical notes

- שמירה על RTL Hebrew בכל ה-UI החדש.
- שימוש ב-design tokens מ-`styles.css` בלבד (אין צבעים hard-coded).
- קמפוננטות shadcn קיימות (Card, Badge, Table, Dialog, Select, Tabs רק לטופס יצירה אם צריך).
- הקבצים החדשים: `src/routes/_app.campaigns.tsx`, `src/routes/_app.campaigns.$id.tsx`, `src/routes/_app.campaigns.new.tsx`, `src/lib/campaigns.functions.ts`, `src/lib/intake-flows.ts`, `src/lib/campaign-context.server.ts`, `src/components/campaign-form.tsx`.
- עדכון `src/routes/api/public/webhook/tamar.ts` ו-`src/lib/i18n.ts` (תוויות חדשות).
- שימוש ב-Lovable AI Gateway (LOVABLE_API_KEY כבר מוגדר) לסקורינג — בלי לבקש מפתחות.

לא נבנה: מנוע שליחת קמפיינים, תשלומים, dating matching (כפי שהוגדר במשימה הקודמת).
