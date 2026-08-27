/**
 * TAMAR BRAIN V2 — durable, idempotent conversation-reset audit.
 *
 * One reset row per inbound message id. A retry of the same wamid records
 * nothing new. History, CRM and consent are never touched here.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = () => supabaseAdmin as any;
const RUNTIME = "tamar_v2";

export async function recordConversationReset(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  message: string;
  cleared: string[];
  reason?: string;
}): Promise<{ recorded: boolean; duplicate: boolean }> {
  if (!args.contactId) return { recorded: false, duplicate: false };
  const key = args.inboundMessageId ?? `no-wamid:${args.contactId}:${Date.now()}`;
  try {
    const { data: existing } = await db()
      .from("tamar_conversation_resets")
      .select("id")
      .eq("inbound_message_id", key)
      .eq("runtime", RUNTIME)
      .maybeSingle();
    if (existing) return { recorded: false, duplicate: true };

    const { error } = await db().from("tamar_conversation_resets").insert({
      contact_id: args.contactId,
      inbound_message_id: key,
      runtime: RUNTIME,
      reason: args.reason ?? "customer_requested_restart",
      trigger_text: String(args.message ?? "").slice(0, 300),
      cleared: { keys: args.cleared },
    });
    return { recorded: !error, duplicate: false };
  } catch {
    return { recorded: false, duplicate: false };
  }
}
