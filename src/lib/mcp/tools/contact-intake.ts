import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../supabase";

export default defineTool({
  name: "get_contact_intake",
  title: "Get contact intake",
  description: "Intake answers and profile facts Tamar has collected for one contact (current values only).",
  inputSchema: { contact_id: z.string().uuid().describe("Contact UUID.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const sb = supabaseForUser(ctx);
    const [answers, facts] = await Promise.all([
      sb.from("relationship_intake_answers")
        .select("question_key,raw_text,structured_value,source,confidence,skipped_by_user,answered_at")
        .eq("contact_id", contact_id).eq("is_current", true),
      sb.from("contact_profile_facts")
        .select("field_key,value_text,value_json,explicit_or_inferred,confidence,source,observed_at")
        .eq("contact_id", contact_id).eq("is_current", true),
    ]);
    const err = answers.error ?? facts.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };
    const payload = {
      intake_answers: (answers.data ?? []).map((a: any) => ({
        question: String(a.question_key),
        answer: a.raw_text ?? null,
        value: a.structured_value == null ? null : JSON.stringify(a.structured_value),
        source: a.source ?? null,
        confidence: a.confidence ?? null,
        skipped: !!a.skipped_by_user,
        answered_at: a.answered_at ?? null,
      })),
      profile_facts: (facts.data ?? []).map((f: any) => ({
        field: String(f.field_key),
        value: f.value_text ?? (f.value_json == null ? null : JSON.stringify(f.value_json)),
        kind: f.explicit_or_inferred ?? null,
        confidence: f.confidence ?? null,
        source: f.source ?? null,
        observed_at: f.observed_at ?? null,
      })),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  },
});
