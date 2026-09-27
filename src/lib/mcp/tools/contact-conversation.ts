import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed } from "../supabase";

export default defineTool({
  name: "get_contact_conversation",
  title: "Get contact conversation",
  description:
    "Full WhatsApp conversation between one contact and Tamar, in chronological order. Find the contact by id or phone.",
  inputSchema: {
    contact_id: z.string().uuid().optional().describe("Contact UUID."),
    phone: z.string().trim().min(4).optional().describe("Phone number or its last digits."),
    limit: z.number().int().min(1).max(500).optional().describe("Max messages (default 100, most recent)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id, phone, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    if (!contact_id && !phone)
      return { content: [{ type: "text", text: "Provide contact_id or phone." }], isError: true };
    const sb = supabaseForUser(ctx);
    let id = contact_id;
    let contact: any = null;
    if (id) {
      const { data } = await sb.from("contacts").select("id,name,phone,status,conversation_state").eq("id", id).maybeSingle();
      contact = data;
    } else {
      const digits = phone!.replace(/\D/g, "");
      const { data } = await sb
        .from("contacts")
        .select("id,name,phone,status,conversation_state")
        .ilike("phone", `%${digits}`)
        .is("archived_at", null)
        .limit(2);
      if ((data ?? []).length > 1)
        return { content: [{ type: "text", text: "More than one contact matches; use more digits." }], isError: true };
      contact = data?.[0] ?? null;
    }
    if (!contact) return { content: [{ type: "text", text: "Contact not found" }], isError: true };
    id = contact.id;
    const { data, error } = await sb
      .from("interactions")
      .select("id,type,source,content,timestamp")
      .eq("contact_id", id!)
      .order("timestamp", { ascending: false })
      .limit(limit ?? 100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const messages = (data ?? []).reverse().map((m: any) => ({
      type: m.type ? String(m.type) : null,
      source: m.source ? String(m.source) : null,
      content: m.content ? String(m.content) : null,
      at: m.timestamp ? String(m.timestamp) : null,
    }));
    const payload = {
      contact: {
        id: String(contact.id),
        name: contact.name ?? null,
        phone: contact.phone ?? null,
        status: contact.status ? String(contact.status) : null,
        conversation_state: contact.conversation_state ? String(contact.conversation_state) : null,
      },
      messages,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  },
});
