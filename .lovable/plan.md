## מודול "ייבוא לידים" ל-Zooga CRM

### 1. סכימת DB (מיגרציה)

**טבלה חדשה: `imported_leads`**
- `id` uuid PK
- `full_name`, `first_name`, `last_name` text
- `phone` text (normalized E.164)
- `source_file_name`, `source_campaign` text
- `import_status` enum: `imported, duplicate, ready_for_intake, sent_to_tamar, replied, converted_to_contact, failed, opted_out` (default `imported`)
- `consent_status` enum: `unknown, approved, declined` (default `unknown`)
- `whatsapp_template_status` enum: `not_sent, sent, delivered, read, replied, failed` (default `not_sent`)
- `contact_id` uuid (קישור לאיש קשר אם דופליקט/הומר)
- `raw_row_data` jsonb
- `last_message_at` timestamptz
- `notes` text
- `created_at`, `updated_at` + טריגר touch_updated_at
- אינדקסים על `phone`, `import_status`

**טבלה חדשה: `intake_campaigns`**
- `id`, `campaign_name`, `template_name`, `tamar_response` jsonb, `status` text, `sent_count` int, `created_at`

**הרחבת `api_settings`:**
- `tamar_backend_url` text
- `tamar_backend_api_token` text

**RLS:** מדיניות ציבורית open (תואמת לשאר המערכת במצב dev הנוכחי).

### 2. מסך "ייבוא לידים" — `/_app/import-leads`

- העלאת CSV (ניתוח client-side עם PapaParse)
- ולידציה: עמודות חובה `full_name`, `phone`; אופציונלי `email`, `city`, `region`, `source_campaign`, `notes`
- נורמליזציה של טלפון לפורמט `+972...`
- בדיקת כפילויות: query ל-`contacts.phone` ול-`imported_leads.phone`. אם קיים contact → סטטוס `duplicate` + `contact_id`. אם קיים בייבוא → דילוג. אחרת → `imported`.
- הצגת סיכום ייבוא + טבלת לידים מסוננת לפי סטטוס
- בחירה מרובה + כפתור "סמן כמוכן לאינטייק" (`ready_for_intake`)

### 3. מסך "קמפיין אינטייק" — `/_app/intake-campaign`

- טבלת לידים עם `import_status = ready_for_intake`
- בחירה מרובה
- שדות: `campaign_name`, `template_name` (select מרשימה קבועה: `zooga_intro_intake` כברירת מחדל)
- תצוגת preview של ההודעה
- כפתור "שלח לתמר" → קורא ל-server function

### 4. Server function — `src/lib/intake-campaign.functions.ts`

- שולף `tamar_backend_url` ו-`tamar_backend_api_token` מ-`api_settings`
- POST ל-`{tamar_backend_url}/campaigns/intake` עם payload כנדרש
- מעדכן `imported_leads.import_status = sent_to_tamar`, `whatsapp_template_status = sent`
- שומר רשומה ב-`intake_campaigns`

### 5. Webhook נכנס לעדכון סטטוסים

`/api/public/webhook/tamar-status` — POST עם `{lead_id, status}` (delivered/read/replied/failed). מעדכן `whatsapp_template_status` ו-`last_message_at`. מאובטח עם `tamar_backend_api_token`.

### 6. הרחבת מסך הגדרות API

הוספת שדות `tamar_backend_url` ו-`tamar_backend_api_token` ב-`/_app/settings/api`.

### 7. ניווט בסיידבר

הוספת קישורים ל-"ייבוא לידים" ו-"קמפיין אינטייק".

### הערות
- אין שליחת וואטסאפ ישירה מ-Lovable
- אין AI בשלב זה
- כל הטקסטים בעברית RTL
- שימוש ב-PapaParse (`bun add papaparse`)
