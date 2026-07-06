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
  name: "create_task",
  title: "Create task",
  description: "Create an operational task, optionally linked to a contact.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Short task title."),
    description: z.string().trim().optional(),
    contact_id: z.string().uuid().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    due_at: z.string().datetime().optional().describe("Due date (ISO 8601)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, description, contact_id, priority, due_at }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("tasks")
      .insert({
        title,
        description: description ?? null,
        contact_id: contact_id ?? null,
        priority: priority ?? "medium",
        due_at: due_at ?? null,
        status: "open",
        source_kind: "mcp",
      })
      .select()
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created task ${data?.id}` }],
      structuredContent: { task: data },
    };
  },
});