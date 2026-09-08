/**
 * Server-side enforcement of the canonical live-send allowlist.
 * Reads the canonical Tamar flag allowlist and audits every blocked attempt.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quiet } from "@/lib/db-safe";
import { isLiveSendAllowed, type AllowlistDecision } from "./live-allowlist";

export async function loadLiveSendPolicy(): Promise<{ allowlist: string[]; openIndividualSends: boolean }> {
  const { data } = await supabaseAdmin
    .from("tamar_feature_flags" as any)
    .select("allowlist,enabled")
    .eq("key", "tamar_v2_enabled")
    .maybeSingle();
  const raw = (data as any)?.allowlist;
  return {
    allowlist: Array.isArray(raw) ? raw.map(String).filter(Boolean) : [],
    openIndividualSends: (data as any)?.enabled === true,
  };
}

export async function loadLiveAllowlist(): Promise<string[]> {
  return (await loadLiveSendPolicy()).allowlist;
}

/**
 * Last gate before a real individual send. Automated paths (lifecycle,
 * campaigns) never pass `adminInitiated`, so they stay allowlist-only.
 * Blocked attempts are audited and never mutate the contact.
 */
export async function assertLiveSendAllowed(args: {
  phone: string | null | undefined;
  contactId: string;
  kind: "pilot_opener" | "pilot_followup" | "consent_opening" | "tamar_reply";
  adminInitiated?: boolean;
}): Promise<AllowlistDecision> {
  const policy = await loadLiveSendPolicy();
  const decision = isLiveSendAllowed(args.phone, policy.allowlist, {
    adminInitiated: args.adminInitiated === true,
    openIndividualSends: policy.openIndividualSends,
  });
  if (!decision.allowed) {
    await quiet(
      supabaseAdmin.from("zero_loss_audit_log" as any).insert({
        actor_label: "live_allowlist",
        action: "allowlist_blocked",
        target_kind: "contact",
        target_id: args.contactId,
        details: { kind: args.kind, reason: decision.reason },
      } as any),
    );
  }
  return decision;
}

