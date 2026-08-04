/**
 * TAMAR BRAIN v1 — versioned copy loader.
 * Persona / consent copy is data, not code. AI cannot change it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CopyRow = {
  id: string;
  copy_key: string;
  variant: string;
  version: number;
  body: string;
  template_name: string | null;
  language_code: string;
  ab_weight: number;
  kill_switch: boolean;
};

const FALLBACKS: Record<string, string> = {
  consent_clarify: "רק כדי לוודא שהבנתי נכון 🙂 — אפשר להמשיך לשלוח לך כאן עדכונים והצעות מזוגה?",
  consent_yes_ack:
    "תודה רבה 🙏 אשמח להכיר אותך קצת כדי להתאים לך דברים שבאמת מתאימים. בכל שלב אפשר לבקש ממני לדבר עם אדם.",
  consent_no_close:
    "תודה ולהתראות. לא נשלח לך הודעות נוספות. אם תרצה בעתיד, אפשר לבקר באתר זוגה: https://www.zooga.co.il או לבקש לדבר עם אדם.",
  handoff_ack:
    "בשמחה — אני מעבירה אותך לאדם מהצוות של זוגה שיחזור אליך. מכאן אני עוצרת ולא אמשיך לשאול שאלות 🙏",
  persona_core:
    "אני תמר, העוזרת הדיגיטלית של זוגה. אני אף פעם לא מתחזה לאדם.",
};

/**
 * Pick the active copy for a key. When A/B is enabled and more than one
 * active variant exists, choose deterministically by contact id so a
 * contact always sees the same variant.
 */
export async function loadCopy(
  copyKey: string,
  opts?: { contactId?: string | null; abEnabled?: boolean },
): Promise<{ body: string; variant: string; version: number; template_name: string | null }> {
  const { data } = await supabaseAdmin
    .from("tamar_copy_versions" as any)
    .select("copy_key,variant,version,body,template_name,ab_weight,kill_switch")
    .eq("copy_key", copyKey)
    .eq("is_active", true)
    .eq("kill_switch", false)
    .order("version", { ascending: false });

  const rows = ((data as any[]) ?? []) as CopyRow[];
  if (!rows.length) {
    return { body: FALLBACKS[copyKey] ?? "", variant: "fallback", version: 0, template_name: null };
  }

  let chosen = rows[0]!;
  if (opts?.abEnabled && rows.length > 1 && opts.contactId) {
    const variants = [...new Map(rows.map((r) => [r.variant, r])).values()];
    let hash = 0;
    for (const ch of opts.contactId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    chosen = variants[hash % variants.length]!;
  }
  return {
    body: chosen.body,
    variant: chosen.variant,
    version: chosen.version,
    template_name: chosen.template_name ?? null,
  };
}

export async function loadBrainPolicy() {
  const { data } = await supabaseAdmin
    .from("tamar_brain_policy" as any)
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (
    (data as any) ?? {
      id: 1,
      consent_gate_enabled: true,
      max_questions_per_message: 1,
      value_before_question_after_answers: 2,
      handoff_confidence_threshold: 60,
      manager_alert_enabled: true,
      manager_alert_template: "zooga_manager_handoff",
      attach_transcript_to_alert: false,
      recommendation_max_offers: 3,
      knowledge_grounding_required: true,
      ab_testing_enabled: false,
      kill_switch_ab: false,
      prompt_version: "tamar-brain-v1",
    }
  );
}