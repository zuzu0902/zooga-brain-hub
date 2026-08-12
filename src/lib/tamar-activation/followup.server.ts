/**
 * Server side of the re-engagement ("עדכון על פעילות חדשה") reply policy.
 *
 * A pending marker is written on the contact when the approved template is
 * sent. The very next inbound message is routed by this module: details +
 * exact link from stored facts, a gentle decline that returns to the next
 * missing intake / relationship question, or a real opt-out.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quiet } from "@/lib/db-safe";
import { OPT_OUT_CONFIRMATION } from "@/lib/optout";
import {
  REENGAGEMENT_DECLINE_TEXT,
  buildActivityDetails,
  routeReengagementReply,
  type ReengagementRouting,
} from "./followup";

export type PendingReengagement = { activation_id: string; offer_id: string | null; at: string };

const PENDING_KEY = "v2_pending_reengagement";
const FRESH_HOURS = 168; // one week

export function pendingReengagementFrom(contact: any): PendingReengagement | null {
  const raw = (contact?.dynamic_profile_fields ?? {})[PENDING_KEY];
  if (!raw?.activation_id || !raw?.at) return null;
  const age = Date.now() - new Date(raw.at).getTime();
  if (!Number.isFinite(age) || age > FRESH_HOURS * 3600_000) return null;
  return raw as PendingReengagement;
}

export async function markPendingReengagement(args: {
  contactId: string;
  activationId: string;
  offerId: string | null;
}): Promise<void> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("dynamic_profile_fields")
    .eq("id", args.contactId)
    .maybeSingle();
  const dyn = { ...(((data as any)?.dynamic_profile_fields as any) ?? {}) };
  dyn[PENDING_KEY] = { activation_id: args.activationId, offer_id: args.offerId, at: new Date().toISOString() };
  await quiet(supabaseAdmin.from("contacts").update({ dynamic_profile_fields: dyn } as any).eq("id", args.contactId));
}

async function clearPending(contactId: string, contact: any) {
  const dyn = { ...((contact?.dynamic_profile_fields as any) ?? {}) };
  delete dyn[PENDING_KEY];
  await quiet(supabaseAdmin.from("contacts").update({ dynamic_profile_fields: dyn } as any).eq("id", contactId));
}

export type ReengagementTurn = { text: string; path: string; routing: ReengagementRouting };

/** Returns a reply for this turn, or null to let the normal engine run. */
export async function handleReengagementReply(args: {
  contact: any;
  message: string;
}): Promise<ReengagementTurn | null> {
  const pending = pendingReengagementFrom(args.contact);
  if (!pending) return null;

  const intakeCompleted = ["completed", "complete", "done"].includes(
    String(args.contact?.baseline_intake_status ?? "").toLowerCase(),
  );
  let relationshipPending = false;
  try {
    const { data } = await supabaseAdmin
      .from("relationship_intake_state" as any)
      .select("status")
      .eq("contact_id", args.contact.id)
      .maybeSingle();
    relationshipPending = !!data && String((data as any).status ?? "") !== "completed";
  } catch {
    relationshipPending = false;
  }

  const routing = routeReengagementReply({ message: args.message, intakeCompleted, relationshipPending });
  if (!routing.consume) return null; // unclear → normal engine handles it

  await clearPending(args.contact.id, args.contact);

  if (routing.opt_out) {
    await quiet(
      supabaseAdmin
        .from("contacts")
        .update({ opted_out_at: new Date().toISOString(), consent_marketing: false } as any)
        .eq("id", args.contact.id),
    );
    return { text: OPT_OUT_CONFIRMATION, path: routing.path, routing };
  }

  if (routing.send_details) {
    let offer: any = null;
    if (pending.offer_id) {
      const { data } = await supabaseAdmin
        .from("offers")
        .select("id, title, offer_url, description, event_date, event_end_date")
        .eq("id", pending.offer_id)
        .maybeSingle();
      offer = data ?? null;
    }
    return {
      text: buildActivityDetails(
        offer
          ? {
              title: String(offer.title),
              offer_url: offer.offer_url ?? null,
              summary: offer.description ?? null,
              event_date: offer.event_date ?? null,
              event_end_date: offer.event_end_date ?? null,
            }
          : null,
      ),
      path: routing.path,
      routing,
    };
  }

  // Not interested in THIS activity — gentle, then back to the CRM's next gap.
  return { text: REENGAGEMENT_DECLINE_TEXT, path: routing.path, routing };
}