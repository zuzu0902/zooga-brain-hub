/**
 * TAMAR BRAIN V2 — idempotent human follow-up for sensitive questions.
 *
 * One task per inbound message id (unique on source_kind + source_message_id),
 * linked to the exact offer when one was resolved. A retry of the same wamid
 * creates nothing new.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sensitiveTaskTitle, type SensitiveTopic } from "./sensitive";

const db = () => supabaseAdmin as any;
const SOURCE_KIND = "tamar_v2_sensitive";

export async function ensureSensitiveFollowupTask(args: {
  contactId: string | null;
  inboundMessageId: string | null;
  offerId: string | null;
  offerTitle: string | null;
  question: string;
  topic: SensitiveTopic;
}): Promise<{ created: boolean; duplicate: boolean }> {
  if (!args.contactId || !args.inboundMessageId) return { created: false, duplicate: false };
  try {
    const { data: existing } = await db()
      .from("tasks")
      .select("id")
      .eq("source_kind", SOURCE_KIND)
      .eq("source_message_id", args.inboundMessageId)
      .maybeSingle();
    if (existing) return { created: false, duplicate: true };

    const { error } = await db().from("tasks").insert({
      contact_id: args.contactId,
      title: sensitiveTaskTitle(args.topic, args.offerTitle),
      description: `שאלה רגישה מהלקוח שדורשת אימות אנושי מול המסלול המדויק:\n"${String(args.question ?? "").slice(0, 500)}"`,
      status: "open",
      priority: "high",
      source_kind: SOURCE_KIND,
      source_message_id: args.inboundMessageId,
      offer_id: args.offerId,
    });
    return { created: !error, duplicate: false };
  } catch {
    return { created: false, duplicate: false };
  }
}
