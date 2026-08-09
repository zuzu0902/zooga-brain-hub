/**
 * IDEMPOTENT VAULT-EVENT PROCESSOR (server-only).
 *
 * Given a durable vault row, guarantee the *recoverable* side effects:
 *  - the phone is registered in the identity registry
 *  - a contact exists and is linked back to the vault row
 *  - status callbacks are applied to the outbound ledger
 *
 * Re-running it is always safe. The conversational reply itself stays in the
 * live webhook path; on retry the reply is only queued in the outbound
 * ledger (allowSend=false) so no duplicate WhatsApp message is ever sent.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveIdentity } from "./identity.server";
import { applyLedgerStatus } from "./outbox.server";

export type ProcessOutcome = {
  kind: "message" | "status" | "unknown";
  contact_id: string | null;
  identity_id: string | null;
};

export async function processVaultEvent(args: {
  vaultId: string;
  jobId: string | null;
  attempt: number;
  allowSend?: boolean;
}): Promise<ProcessOutcome> {
  const { data } = await supabaseAdmin
    .from("inbound_event_vault" as any)
    .select("id, event_type, raw_payload, normalized_phone")
    .eq("id", args.vaultId)
    .maybeSingle();
  const row: any = data;
  if (!row) throw new Error("vault_row_missing");

  const eventType = String(row.event_type ?? "unknown");

  if (eventType.startsWith("status.")) {
    const providerId = row.raw_payload?.status?.id ? String(row.raw_payload.status.id) : null;
    const status = String(row.raw_payload?.status?.status ?? "");
    if (providerId && status) await applyLedgerStatus(providerId, status);
    return { kind: "status", contact_id: null, identity_id: null };
  }

  if (!eventType.startsWith("message.")) {
    throw new Error("unknown_event_shape");
  }

  const displayName =
    row.raw_payload?.contacts?.[0]?.profile?.name ? String(row.raw_payload.contacts[0].profile.name) : null;
  const resolution = await resolveIdentity({
    phone: row.normalized_phone,
    displayName,
    source: "meta_whatsapp",
  });
  if (!resolution.normalized_phone) throw new Error("invalid_phone");
  // A message event is only recoverable once it owns a real contact row.
  // Without it the job stays retryable instead of being closed as succeeded.
  if (!resolution.contact_id) throw new Error("contact_resolution_failed: contact_missing");

  await supabaseAdmin
    .from("inbound_event_vault" as any)
    .update({ contact_id: resolution.contact_id } as any)
    .eq("id", args.vaultId);

  return { kind: "message", contact_id: resolution.contact_id, identity_id: resolution.identity_id };
}