import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_contact",
  title: "Get contact",
  description: "Fetch a single contact by id, with recent interactions and extracted attributes.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact UUID."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const [{ data: contact, error: cErr }, { data: interactions }, { data: attributes }] =
      await Promise.all([
        sb.from("contacts").select("*").eq("id", contact_id).maybeSingle(),
        sb.from("interactions").select("id,type,direction,content,timestamp").eq("contact_id", contact_id).order("timestamp", { ascending: false }).limit(20),
        sb.from("extracted_attributes").select("attribute_key,attribute_value,confidence,updated_at").eq("contact_id", contact_id),
      ]);
    if (cErr) return { content: [{ type: "text", text: cErr.message }], isError: true };
    if (!contact) return { content: [{ type: "text", text: "Contact not found" }], isError: true };
    const payload = { contact, recent_interactions: interactions ?? [], attributes: attributes ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});