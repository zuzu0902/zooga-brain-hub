import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../supabase";

export default defineTool({
  name: "list_recent_messages",
  title: "List recent WhatsApp messages",
  description:
    "Latest WhatsApp messages across all contacts (customer messages and Tamar replies), newest first, with contact name and phone.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional().describe("Max messages (default 50)."),
    since: z.string().datetime().optional().describe("Only messages after this ISO time."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, since }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("interactions")
      .select("id,contact_id,type,source,content,timestamp,contacts(name,phone)")
      .order("timestamp", { ascending: false })
      .limit(limit ?? 50);
    if (since) q = q.gt("timestamp", since);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const messages = (data ?? []).map((m: any) => ({
      id: String(m.id),
      contact_id: m.contact_id ? String(m.contact_id) : null,
      contact_name: m.contacts?.name ?? null,
      contact_phone: m.contacts?.phone ?? null,
      type: m.type ? String(m.type) : null,
      source: m.source ? String(m.source) : null,
      content: m.content ? String(m.content) : null,
      at: m.timestamp ? String(m.timestamp) : null,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
      structuredContent: { messages },
    };
  },
});
