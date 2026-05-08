import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const HIGH_CONFIDENCE = 75;

const FIELD_DEFS = {
  // text fields — overwrite only when empty (smart) or when confidence very high
  text_overwrite_if_empty: [
    "city", "region", "relationship_status", "preferred_trip_style", "preferred_social_style",
    "communication_style", "emotional_profile", "social_profile", "sales_profile",
    "budget_sensitivity", "loneliness_signal", "relationship_readiness", "vip_potential",
    "purchase_intent", "sales_temperature", "age_range", "conversation_intent",
  ],
  number_overwrite_if_empty: ["age", "openness_score", "community_fit_score"],
  // arrays — always merge (union)
  array_merge: [
    "interests", "lifestyle_tags", "tags", "hobbies", "preferred_events",
    "travel_preferences", "favorite_activity_types", "personality_tags",
    "emotional_needs", "relationship_goals", "social_goals", "likely_needs",
    "decision_triggers", "objections",
  ],
};

const ALL_FIELDS = [
  ...FIELD_DEFS.text_overwrite_if_empty,
  ...FIELD_DEFS.number_overwrite_if_empty,
  ...FIELD_DEFS.array_merge,
];

const SYSTEM_PROMPT = `אתה מנוע מודיעין שיחה לCRM ישראלי בשם זוגה.
תפקידך: לחלץ תובנות מובנות משיחת WhatsApp בעברית בין משתמש לבוט בשם תמר.

כללים קריטיים:
- אל תמציא. אם אינך בטוח — דווח על confidence נמוך.
- חלץ רק מה שנאמר במפורש או רמוז חזק.
- העדף שמירת ההיסטוריה: הוסף לרשימות, אל תחליף.
- ציון בטחון 0-100. רק >= 75 ייושם אוטומטית.
- כל ערך טקסט בעברית.
- אל תכלול שדות שלא ניתן לחלץ.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "extract_intelligence",
    description: "Extract structured CRM intelligence from a WhatsApp conversation",
    parameters: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          description: "List of extracted profile insights",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["demographics","personality","emotional_state","interests","lifestyle","relationships","communication_style","travel_style","social_style","sales_behavior","engagement_behavior","objections","event_preferences"],
              },
              field: { type: "string", description: `One of: ${ALL_FIELDS.join(", ")}` },
              value: { description: "string, number, or array of strings" },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              reasoning: { type: "string", description: "Why this was extracted, in Hebrew" },
            },
            required: ["category", "field", "value", "confidence", "reasoning"],
            additionalProperties: false,
          },
        },
        memories: {
          type: "array",
          description: "Long-term conversational memories worth keeping",
          items: {
            type: "object",
            properties: {
              memory_type: { type: "string", enum: ["fact","preference","emotion","event","relationship","goal"] },
              memory_key: { type: "string", description: "Short Hebrew key, e.g. 'בן 54' or 'אוהב טיולים שקטים'" },
              memory_value: { type: "string", description: "Full Hebrew sentence describing the memory" },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
            },
            required: ["memory_type", "memory_key", "memory_value", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["insights", "memories"],
      additionalProperties: false,
    },
  },
};

export async function runExtraction(contactId: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const { data: contact } = await supabaseAdmin
    .from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!contact) throw new Error("Contact not found");

  const { data: interactions } = await supabaseAdmin
    .from("interactions")
    .select("type, source, content, timestamp")
    .eq("contact_id", contactId)
    .order("timestamp", { ascending: false })
    .limit(15);

  const recent = (interactions ?? []).slice().reverse();
  if (recent.length === 0) {
    return { skipped: true, reason: "no interactions" };
  }

  const profileSnapshot: Record<string, any> = {};
  for (const f of ALL_FIELDS) {
    const v = (contact as any)[f];
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
      profileSnapshot[f] = v;
    }
  }

  const conversationText = recent
    .map((i: any) => `[${i.type}] ${i.content || ""}`)
    .join("\n");

  const userPrompt = [
    "## פרופיל קיים של איש הקשר",
    JSON.stringify(profileSnapshot, null, 2),
    "",
    "## תמלול שיחה אחרונה (15 הודעות אחרונות)",
    conversationText,
    "",
    "חלץ תובנות חדשות בלבד. שדות שכבר קיימים בפרופיל — אל תציע אלא אם יש מידע חדש או סותר.",
  ].join("\n");

  const aiResp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_intelligence" } },
    }),
  });

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    throw new Error(`AI gateway ${aiResp.status}: ${errText.slice(0, 200)}`);
  }

  const aiJson = await aiResp.json();
  const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return { skipped: true, reason: "no tool call" };

  let parsed: any;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return { skipped: true, reason: "bad json" };
  }

  const insights: any[] = parsed.insights ?? [];
  const memories: any[] = parsed.memories ?? [];
  const lastMessage = recent[recent.length - 1]?.content ?? null;

  const patch: Record<string, any> = {};
  const historyRows: any[] = [];
  const pendingRows: any[] = [];

  for (const ins of insights) {
    const field = String(ins.field || "");
    const value = ins.value;
    const conf = Number(ins.confidence ?? 0);

    if (!ALL_FIELDS.includes(field)) continue;

    if (conf < HIGH_CONFIDENCE) {
      pendingRows.push({
        contact_id: contactId,
        category: ins.category || "general",
        field_name: field,
        proposed_value: { value },
        confidence_score: conf,
        reasoning: ins.reasoning || null,
        source_message: lastMessage,
      });
      continue;
    }

    const existing = (contact as any)[field];

    if (FIELD_DEFS.array_merge.includes(field)) {
      const incoming = Array.isArray(value) ? value : [value];
      const merged = Array.from(new Set([...(existing || []), ...incoming.map(String)]));
      if (merged.length !== (existing || []).length) {
        patch[field] = merged;
        historyRows.push({
          contact_id: contactId, field_name: field,
          old_value: JSON.stringify(existing || []),
          new_value: JSON.stringify(merged),
          changed_by: "ai_extraction",
          confidence_score: conf,
          source: "conversation_intelligence",
        });
      }
    } else if (FIELD_DEFS.number_overwrite_if_empty.includes(field)) {
      if ((existing === null || existing === undefined) && value !== null) {
        patch[field] = Number(value);
        historyRows.push({
          contact_id: contactId, field_name: field,
          old_value: existing == null ? null : String(existing),
          new_value: String(value),
          changed_by: "ai_extraction",
          confidence_score: conf,
          source: "conversation_intelligence",
        });
      }
    } else {
      // text_overwrite_if_empty
      if (!existing && value) {
        patch[field] = String(value);
        historyRows.push({
          contact_id: contactId, field_name: field,
          old_value: existing || null,
          new_value: String(value),
          changed_by: "ai_extraction",
          confidence_score: conf,
          source: "conversation_intelligence",
        });
      }
    }
  }

  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("contacts").update(patch).eq("id", contactId);
  }
  if (historyRows.length > 0) {
    await supabaseAdmin.from("contact_profile_history").insert(historyRows);
  }
  if (pendingRows.length > 0) {
    await supabaseAdmin.from("pending_ai_insights").insert(pendingRows);
  }

  if (memories.length > 0) {
    const memRows = memories.map((m) => ({
      contact_id: contactId,
      memory_type: String(m.memory_type || "fact"),
      memory_key: String(m.memory_key || "").slice(0, 200),
      memory_value: String(m.memory_value || ""),
      confidence_score: Number(m.confidence ?? 0),
      source_message: lastMessage,
      extracted_from: "conversation_intelligence",
    })).filter((r) => r.memory_key && r.memory_value);
    if (memRows.length > 0) {
      await supabaseAdmin.from("contact_memories").insert(memRows);
    }
  }

  return {
    ok: true,
    applied: Object.keys(patch),
    pending: pendingRows.length,
    memories: memories.length,
  };
}