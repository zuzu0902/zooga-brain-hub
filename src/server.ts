require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const SYSTEM_PROMPT = `
את תמר מזוגה.

את לא צ'אט כללי.
את לא מלווה רגשית כללית.
את לא מציעה רעיונות אקראיים כמו הליכה בים, קפה, פארק או פעילויות שלא קשורות לזוגה, אלא אם יש לכך קשר ברור לפעילות אמיתית של זוגה.

את מנהלת שיחת אינטייק חכמה לקהילת זוגה.

זוגה היא קהילה חברתית לאנשים שמחפשים:
- חיבור אנושי
- זוגיות
- חברים חדשים
- אירועים חברתיים
- טיולים
- הרצאות
- מסיבות
- פעילויות איכותיות

המטרה שלך בכל שיחה:
1. ליצור קשר אישי נעים
2. להבין מי האדם
3. לאסוף מידע הדרגתי ל־CRM
4. לסווג אותו לפי תחומי עניין
5. להכין בסיס לקמפיינים חכמים בעתיד
6. לא להרגיש כמו שאלון
7. לא למכור מוקדם מדי

כללי שיחה:
- עברית טבעית, קצרה וחמה
- שאלה אחת בלבד בכל הודעה
- אם לא ידוע מגדר, לדבר בלשון ניטרלית
- לא לכתוב "אתה" או "את" לפני שידוע איך לפנות
- לא להמציא פעילויות
- לא להציע אירוע ספציפי אם אין לך מידע על אירועים אמיתיים
- אם האדם שואל על פעילות ספציפית ואין לך מידע, תגידי שתבדקי מול הצוות

תהליך אינטייק למשתמש חדש:
אם אין מידע בסיסי על האדם, עלייך להתקדם לפי הסדר הזה:

שלב 1:
לברך ולשאול שם, או אם כבר יש שם מהוואטסאפ להשתמש בו בעדינות.

שלב 2:
לשאול איך נוח לפנות אליו או אליה, כדי להימנע מטעות מגדרית.

שלב 3:
לשאול אזור מגורים.

שלב 4:
לשאול גיל או טווח גילאים.

שלב 5:
לשאול מה יותר מעניין אותו בזוגה:
טיולים, אירועים חברתיים, מסיבות, הרצאות, היכרויות, קהילה, או משהו אחר.

שלב 6:
לשאול האם מותר לשלוח עדכונים על פעילויות רלוונטיות והטבות אישיות.

אסור לשאול את כל השאלות יחד.
בכל תגובה רק שאלה אחת טבעית.

פתיחה לשיחה יזומה ראשונה:
"היי, כאן תמר מזוגה 🙂 אנחנו מעדכנים את רשימת החברים שלנו כדי לשלוח רק פעילויות רלוונטיות והטבות אישיות."

לאחר הפתיחה המשיכי בשאלה אחת בלבד.

אם האדם שואל "מה יש היום" או "מה יש לעשות":
אל תמציאי פעילויות.
עני:
"כדי לכוון אותך למשהו שבאמת מתאים, אשמח להבין קודם איזה סוג פעילות יותר מעניין אותך בזוגה — טיולים, אירועים חברתיים, מסיבות או הרצאות?"

אם האדם אומר שהוא רוצה לצאת היום:
עני:
"מעולה 🙂 כדי לבדוק מה יכול להתאים, איזה סוג יציאה הכי מדבר אליך הערב — משהו חברתי רגוע, מסיבה, הרצאה או פעילות עם קבוצה?"

מטרת השיחה אינה בידור כללי.
מטרת השיחה היא לבנות היכרות, סיווג ותשתית לפעולה עתידית בזוגה.
`;

async function initDatabase() {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phone TEXT UNIQUE,
    name TEXT,
    gender TEXT,
    preferred_language_style TEXT,
    city TEXT,
    region TEXT,
    age TEXT,
    birth_date TEXT,
    interests TEXT[] DEFAULT ARRAY[]::TEXT[],
    consent_marketing BOOLEAN DEFAULT NULL,
    intake_stage TEXT DEFAULT 'new',
    status TEXT DEFAULT 'new',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    phone TEXT,
    role TEXT,
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS outbound_campaign_leads (
    id SERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    template_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    full_name TEXT,
    wa_message_id TEXT,
    send_status TEXT DEFAULT 'pending',
    send_error TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )
  `);

  await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS outbound_campaign_leads_lead_campaign_idx
  ON outbound_campaign_leads (lead_id, campaign_name)
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language_style TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS age TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT ARRAY[]::TEXT[]`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_marketing BOOLEAN DEFAULT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS intake_stage TEXT DEFAULT 'new'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  console.log("Database ready");
}

async function getUser(phone) {
  const result = await pool.query(
    `SELECT * FROM users WHERE phone = $1 LIMIT 1`,
    [phone]
  );
  return result.rows[0] || null;
}

async function createOrUpdateUser(phone, name = "") {
  await pool.query(
    `
    INSERT INTO users(phone, name)
    VALUES($1, $2)
    ON CONFLICT(phone)
    DO UPDATE SET
      name = COALESCE(NULLIF(users.name, ''), EXCLUDED.name),
      updated_at = NOW()
    `,
    [phone, name]
  );
}

async function saveMessage(phone, role, content) {
  await pool.query(
    `
    INSERT INTO messages(phone, role, content)
    VALUES($1, $2, $3)
    `,
    [phone, role, content]
  );
}

async function getConversation(phone) {
  const result = await pool.query(
    `
    SELECT role, content
    FROM messages
    WHERE phone = $1
    ORDER BY created_at DESC
    LIMIT 12
    `,
    [phone]
  );

  return result.rows.reverse();
}

async function extractProfileData(phone, userMessage) {
  const user = await getUser(phone);

  const extractionPrompt = `
את מנוע חילוץ מידע פנימי של זוגה.
קבלי הודעה של משתמש ועדכני רק מידע שנאמר בבירור.
אל תנחשי.

פרופיל נוכחי:
${JSON.stringify(user || {}, null, 2)}

הודעת המשתמש:
${userMessage}

החזירי JSON בלבד במבנה הבא:
{
  "name": "",
  "gender": "",
  "preferred_language_style": "",
  "city": "",
  "region": "",
  "age": "",
  "birth_date": "",
  "interests": [],
  "consent_marketing": null,
  "next_intake_stage": ""
}

כללים:
- gender יכול להיות male, female או unknown
- preferred_language_style יכול להיות male, female או neutral
- consent_marketing true רק אם המשתמש אישר בבירור לקבל עדכונים
- consent_marketing false רק אם ביקש לא לקבל או להסיר
- interests רק מתוך מה שנאמר או הובן בבירור
- next_intake_stage לפי המידע שחסר:
  ask_name
  ask_gender_style
  ask_region
  ask_age
  ask_interests
  ask_consent
  complete
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
      temperature: 0.1,
    });

    const raw = completion.choices[0].message.content || "{}";
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleaned);

    const currentInterests = user?.interests || [];
    const newInterests = Array.isArray(data.interests) ? data.interests : [];
    const mergedInterests = [...new Set([...currentInterests, ...newInterests])];

    await pool.query(
      `
      UPDATE users SET
        name = COALESCE(NULLIF($2, ''), name),
        gender = COALESCE(NULLIF($3, ''), gender),
        preferred_language_style = COALESCE(NULLIF($4, ''), preferred_language_style),
        city = COALESCE(NULLIF($5, ''), city),
        region = COALESCE(NULLIF($6, ''), region),
        age = COALESCE(NULLIF($7, ''), age),
        birth_date = COALESCE(NULLIF($8, ''), birth_date),
        interests = $9,
        consent_marketing = COALESCE($10, consent_marketing),
        intake_stage = COALESCE(NULLIF($11, ''), intake_stage),
        updated_at = NOW()
      WHERE phone = $1
      `,
      [
        phone,
        data.name || "",
        data.gender || "",
        data.preferred_language_style || "",
        data.city || "",
        data.region || "",
        data.age || "",
        data.birth_date || "",
        mergedInterests,
        data.consent_marketing,
        data.next_intake_stage || "",
      ]
    );
  } catch (error) {
    console.log("Profile extraction failed:", error.message);
  }
}

async function findLatestOutboundLeadByPhone(phone) {
  const result = await pool.query(
    `
    SELECT lead_id, campaign_name, template_name
    FROM outbound_campaign_leads
    WHERE phone = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [phone]
  );

  return result.rows[0] || null;
}

async function syncToZoogaCRM(phone, message, profileName = "") {
  if (!process.env.ZOOGA_CRM_WEBHOOK_URL || !process.env.ZOOGA_CRM_WEBHOOK_TOKEN) {
    console.log("CRM sync skipped: missing Zooga CRM env vars");
    return;
  }

  try {
    const user = await getUser(phone);
    const outboundLead = await findLatestOutboundLeadByPhone(phone);

    const payload = {
      phone: phone,
      whatsapp_number: phone,
      lead_id: outboundLead?.lead_id || null,
      name: user?.name || profileName || "",
      gender: user?.gender || "",
      preferred_language_style: user?.preferred_language_style || "",
      city: user?.city || "",
      region: user?.region || "",
      age: user?.age || "",
      birth_date: user?.birth_date || "",
      interests: user?.interests || [],
      consent_marketing: user?.consent_marketing,
      intake_status: user?.intake_stage || "started",
      message: message,
      source: "Tamar WhatsApp"
    };

    const response = await axios.post(
      process.env.ZOOGA_CRM_WEBHOOK_URL,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-token": process.env.ZOOGA_CRM_WEBHOOK_TOKEN,
        },
      }
    );

    console.log("CRM sync success:", response.status);
  } catch (error) {
    console.log("CRM sync error:", error.response?.data || error.message);
  }
}

function buildUserContext(user) {
  if (!user) return "";

  return `
פרופיל ידוע:
שם: ${user.name || "לא ידוע"}
טלפון: ${user.phone || ""}
סגנון פנייה מועדף: ${user.preferred_language_style || "לא ידוע"}
מגדר: ${user.gender || "לא ידוע"}
עיר: ${user.city || "לא ידוע"}
אזור: ${user.region || "לא ידוע"}
גיל: ${user.age || "לא ידוע"}
תאריך לידה: ${user.birth_date || "לא ידוע"}
תחומי עניין: ${(user.interests || []).join(", ") || "לא ידוע"}
אישור עדכונים: ${user.consent_marketing === true ? "כן" : user.consent_marketing === false ? "לא" : "לא ידוע"}
שלב אינטייק: ${user.intake_stage || "new"}
`;
}

function getZoogaRuntimePackUrl() {
  if (process.env.ZOOGA_RUNTIME_PACK_URL) {
    return process.env.ZOOGA_RUNTIME_PACK_URL;
  }

  if (process.env.ZOOGA_CRM_WEBHOOK_URL) {
    return process.env.ZOOGA_CRM_WEBHOOK_URL.replace(
      /\/api\/public\/webhook\/tamar$/,
      "/api/public/runtime/tamar-pack"
    );
  }

  return null;
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
      content: String(m.content),
    }));
}

function buildFallbackMessages(user, history, userMessage) {
  return [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "system",
      content: buildUserContext(user),
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];
}

async function fetchZoogaRuntimePack({ phone, userMessage }) {
  const runtimePackUrl = getZoogaRuntimePackUrl();
  const runtimeToken = process.env.ZOOGA_CRM_WEBHOOK_TOKEN;

  if (!runtimePackUrl || !runtimeToken) {
    return {
      ok: false,
      reason: "missing_runtime_pack_env",
      runtimePackUrl,
    };
  }

  try {
    const response = await axios.post(
      runtimePackUrl,
      {
        phone,
        whatsapp_number: phone,
        message: userMessage,
        source: "Tamar WhatsApp",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-token": runtimeToken,
        },
        timeout: 15000,
      }
    );

    return {
      ok: true,
      data: response.data,
    };
  } catch (error) {
    console.log("Runtime pack fetch failed:", error.response?.data || error.message);
    return {
      ok: false,
      reason: "runtime_pack_request_failed",
      error: error.response?.data || error.message,
      runtimePackUrl,
    };
  }
}

async function generateReply(phone, userMessage) {
  const user = await getUser(phone);
  const history = await getConversation(phone);

  const runtimePackResult = await fetchZoogaRuntimePack({ phone, userMessage });

  let messages;
  let runtimeMode = "fallback_local_prompt";

  if (runtimePackResult.ok && runtimePackResult.data?.runtime_prompt_context?.messages) {
    const packMessages = normalizeChatMessages(
      runtimePackResult.data.runtime_prompt_context.messages
    );

    if (packMessages.length > 0) {
      messages = packMessages;
      runtimeMode = "zooga_runtime_pack";
    }
  }

  if (!messages) {
    messages = buildFallbackMessages(user, history, userMessage);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    temperature: 0.5,
  });

  const reply = completion.choices[0].message.content || "היי, קיבלתי 🙂";

  console.log("Reply generation mode:", runtimeMode);
  if (runtimePackResult.ok) {
    console.log(
      "Runtime pack composition version:",
      runtimePackResult.data?.runtime_prompt_context?.composition_version || null
    );
    console.log(
      "Runtime pack injected sections:",
      runtimePackResult.data?._observability?.prompt_composition?.injected_sections ||
        runtimePackResult.data?.runtime_prompt_context?.injected_sections ||
        null
    );
  } else {
    console.log("Runtime pack unavailable; fallback reason:", runtimePackResult.reason);
  }

  return reply;
}

async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: text,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function sendWhatsAppTemplate(to, templateName, fullName) {
  const response = await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "he"
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: fullName || ""
              }
            ]
          }
        ]
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

async function saveOutboundCampaignLead({
  leadId,
  campaignName,
  templateName,
  phone,
  fullName,
  waMessageId,
  sendStatus,
  sendError,
}) {
  await pool.query(
    `
    INSERT INTO outbound_campaign_leads
    (lead_id, campaign_name, template_name, phone, full_name, wa_message_id, send_status, send_error, sent_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (lead_id, campaign_name)
    DO UPDATE SET
      template_name = EXCLUDED.template_name,
      phone = EXCLUDED.phone,
      full_name = EXCLUDED.full_name,
      wa_message_id = EXCLUDED.wa_message_id,
      send_status = EXCLUDED.send_status,
      send_error = EXCLUDED.send_error,
      sent_at = NOW()
    `,
    [
      leadId,
      campaignName,
      templateName,
      phone,
      fullName,
      waMessageId || null,
      sendStatus,
      sendError || null,
    ]
  );
}

app.post("/campaigns/intake", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const expectedToken = process.env.TAMAR_API_TOKEN;

    if (!expectedToken || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== expectedToken) {
      return res.status(401).json({
        ok: false,
        error: "unauthorized",
      });
    }

    const { campaign_name, template_name, leads } = req.body || {};

    if (
      !campaign_name ||
      typeof campaign_name !== "string" ||
      !template_name ||
      typeof template_name !== "string" ||
      !Array.isArray(leads)
    ) {
      return res.status(400).json({
        ok: false,
        error: "invalid_request",
        details: "campaign_name, template_name, and leads[] are required",
      });
    }

    const results = [];

    for (const lead of leads) {
      const leadId = lead?.lead_id;
      const fullName = lead?.full_name;
      const phone = lead?.phone;

      if (!leadId || !fullName || !phone) {
        results.push({
          lead_id: leadId || null,
          phone: phone || null,
          status: "failed",
          error: "missing_required_fields",
        });
        continue;
      }

      try {
        const sendResult = await sendWhatsAppTemplate(phone, template_name, fullName);
        const waMessageId = sendResult?.messages?.[0]?.id || null;

        await saveOutboundCampaignLead({
          leadId,
          campaignName: campaign_name,
          templateName: template_name,
          phone,
          fullName,
          waMessageId,
          sendStatus: "sent",
          sendError: null,
        });

        results.push({
          lead_id: leadId,
          phone,
          status: "sent",
          wa_message_id: waMessageId,
        });
      } catch (error) {
        const errorBody = error.response?.data ? JSON.stringify(error.response.data) : error.message;

        await saveOutboundCampaignLead({
          leadId,
          campaignName: campaign_name,
          templateName: template_name,
          phone,
          fullName,
          waMessageId: null,
          sendStatus: "failed",
          sendError: errorBody,
        });

        results.push({
          lead_id: leadId,
          phone,
          status: "failed",
          error: error.response?.data || error.message,
        });
      }
    }

    const accepted = results.filter((r) => r.status === "sent").length;
    const rejected = results.filter((r) => r.status === "failed").length;

    return res.status(200).json({
      ok: true,
      campaign_ref: `tamar-${Date.now()}`,
      accepted,
      rejected,
      results,
    });
  } catch (error) {
    console.error("Campaign intake error:", error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      details: error.message,
    });
  }
});

app.get("/", (req, res) => {
  res.send("Tamar Bot Running");
});

app.get("/webhook", (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const phone = message.from;
    const userMessage = message.text?.body || "";
    const profileName = value?.contacts?.[0]?.profile?.name || "";
    const outboundLead = await findLatestOutboundLeadByPhone(phone);

    console.log("Incoming message from", phone, ":", userMessage);
    console.log("Matched outbound lead:", outboundLead);

    await createOrUpdateUser(phone, profileName);
    await saveMessage(phone, "user", userMessage);

    await extractProfileData(phone, userMessage);

    const aiReply = await generateReply(phone, userMessage);

    await saveMessage(phone, "assistant", aiReply);

    await sendWhatsAppMessage(phone, aiReply);

    await syncToZoogaCRM(phone, userMessage, profileName);

    console.log("Reply:", aiReply);

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook Error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log("Server running on port", PORT);
  });
});
