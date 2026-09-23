/**
 * AGENT COMMAND BRIDGE — Hostinger Gateway -> Lovable, strictly constrained.
 *
 * Auth (this route only): Authorization: Bearer <gateway token>, validated
 * solely through the public.zooga_core_gateway_authorized RPC (SHA-256 digest
 * of the active `hostinger-core` credential, compared inside the database).
 * No token, secret or customer message text is ever logged or echoed.
 *
 * Supported commands: contact.reset, crm.patch_contact, tamar.redeploy.
 * Anything else is rejected. There is no arbitrary SQL, shell, secret read or
 * broad database access here. tamar.redeploy NEVER deploys: it queues an
 * audited request for a human publish.
 *
 * Idempotency: every request carries an idempotency_key. The key is claimed in
 * public.zooga_agent_commands before any mutation, so a duplicate returns the
 * prior sanitized result and can never repeat a mutation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SUPPORTED_COMMANDS = ["contact.reset", "crm.patch_contact", "tamar.redeploy"] as const;
export type SupportedCommand = (typeof SUPPORTED_COMMANDS)[number];

/** Only these contact fields may ever be patched through this bridge. */
export const ALLOWED_PATCH_FIELDS = ["status", "conversation_state"] as const;
export const ALLOWED_STATUS = [
  "new_lead",
  "active_member",
  "interested",
  "customer",
  "VIP",
  "inactive",
] as const;
export const ALLOWED_CONVERSATION_STATE = [
  "consent_pending",
  "consented",
  "opted_out",
  "intake_active",
  "value_delivery",
  "offer_recommended",
  "human_handoff_queued",
  "human_owned",
  "paused",
  "closed",
  "new_inbound",
  "consent_asked",
  "recommendation_ready",
  "value_delivered",
] as const;

/** Request limits — keep the surface small and cheap. */
export const LIMITS = {
  maxBodyBytes: 4096,
  idempotencyKey: { min: 8, max: 200 },
  reason: { min: 3, max: 500 },
  phoneDigits: { min: 9, max: 15 },
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "cache-control": "no-store" },
  });
}

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 20 ? token : null;
}

/** Canonical Israeli MSISDN: digits only, 0XXXXXXXXX -> 972XXXXXXXXX. */
export function canonicalIsraeliPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "972" + digits.slice(1);
  if (digits.length < LIMITS.phoneDigits.min || digits.length > LIMITS.phoneDigits.max) return null;
  return digits;
}

export function phoneVariants(canonical: string): string[] {
  const local = canonical.startsWith("972") ? "0" + canonical.slice(3) : canonical;
  return Array.from(new Set([`+${canonical}`, canonical, local]));
}

/** Never return or log a full phone number. */
export function maskPhone(canonical: string): string {
  return `***${canonical.slice(-4)}`;
}

/** Strips anything that could carry customer text; keeps booleans/numbers/short status strings. */
export function sanitizeResetResult(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean" || typeof v === "number") out[k] = v;
    else if (typeof v === "string" && v.length <= 48 && /^[a-z0-9_.:-]*$/i.test(v)) out[k] = v;
  }
  return out;
}

export function validatePatch(
  patch: unknown,
): { ok: true; status: string | null; conversationState: string | null } | { ok: false; error: string; field?: string } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "invalid_patch" };
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "empty_patch" };
  for (const [key] of entries) {
    if (!(ALLOWED_PATCH_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: "unsupported_field", field: key };
    }
  }
  const status = (patch as any).status ?? null;
  const conversationState = (patch as any).conversation_state ?? null;
  if (status !== null && !(ALLOWED_STATUS as readonly string[]).includes(String(status))) {
    return { ok: false, error: "invalid_status" };
  }
  if (
    conversationState !== null &&
    !(ALLOWED_CONVERSATION_STATE as readonly string[]).includes(String(conversationState))
  ) {
    return { ok: false, error: "invalid_conversation_state" };
  }
  return {
    ok: true,
    status: status === null ? null : String(status),
    conversationState: conversationState === null ? null : String(conversationState),
  };
}

async function authorizeGateway(request: Request): Promise<string | null> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    const { data, error } = await (supabaseAdmin as any).rpc("zooga_core_gateway_authorized", {
      _gateway_token: token,
    });
    return !error && data === true ? token : null;
  } catch {
    return null;
  }
}

async function resolveSingleContact(canonical: string) {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .in("phone", phoneVariants(canonical))
    .limit(2);
  if (error) return { error: "contact_lookup_failed" as const };
  if (!data || data.length === 0) return { error: "contact_not_found" as const };
  if (data.length > 1) return { error: "ambiguous_phone" as const };
  return { contactId: data[0]!.id as string };
}

async function pickAdminActor(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1);
  return (data?.[0]?.user_id as string | undefined) ?? null;
}

export const Route = createFileRoute("/api/public/runtime/agent-command")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = await authorizeGateway(request);
        if (!token) return json({ ok: false, error: "unauthorized" }, 401);

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > LIMITS.maxBodyBytes) return json({ ok: false, error: "payload_too_large" }, 413);

        const rawText = await request.text().catch(() => "");
        if (rawText.length > LIMITS.maxBodyBytes) return json({ ok: false, error: "payload_too_large" }, 413);

        let body: any;
        try {
          body = JSON.parse(rawText || "{}");
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }

        const command = typeof body?.command === "string" ? body.command.trim() : "";
        if (!(SUPPORTED_COMMANDS as readonly string[]).includes(command)) {
          return json({ ok: false, error: "unsupported_command" }, 400);
        }

        const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key.trim() : "";
        if (
          idempotencyKey.length < LIMITS.idempotencyKey.min ||
          idempotencyKey.length > LIMITS.idempotencyKey.max
        ) {
          return json({ ok: false, error: "idempotency_key_required" }, 400);
        }

        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        if (reason.length < LIMITS.reason.min || reason.length > LIMITS.reason.max) {
          return json({ ok: false, error: "reason_required" }, 400);
        }

        // Phone is required for the two contact-scoped commands.
        let canonical: string | null = null;
        if (command !== "tamar.redeploy") {
          canonical = canonicalIsraeliPhone(body?.phone);
          if (!canonical) return json({ ok: false, error: "invalid_phone" }, 400);
        }

        // Validate the patch shape before claiming the idempotency key.
        let patch: { status: string | null; conversationState: string | null } | null = null;
        if (command === "crm.patch_contact") {
          const validated = validatePatch(body?.patch);
          if (!validated.ok) {
            return json({ ok: false, error: validated.error, field: validated.field ?? undefined }, 400);
          }
          patch = { status: validated.status, conversationState: validated.conversationState };
        }

        // ---- Idempotency claim (before any mutation) ----
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("zooga_agent_commands")
          .insert({
            idempotency_key: idempotencyKey,
            command,
            reason,
            target_masked: canonical ? maskPhone(canonical) : null,
          })
          .select("id, correlation_id")
          .maybeSingle();

        if (claimError || !claimed) {
          const { data: prior } = await supabaseAdmin
            .from("zooga_agent_commands")
            .select("command, status, result")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (prior) {
            if (prior.command !== command) {
              return json({ ok: false, error: "idempotency_key_conflict" }, 409);
            }
            return json({ ...(prior.result as Record<string, unknown>), duplicate: true, replayed: true, status_state: prior.status }, 200);
          }
          return json({ ok: false, error: "command_claim_failed" }, 500);
        }

        const correlationId = claimed.correlation_id as string;
        let result: Record<string, unknown>;
        let httpStatus = 200;

        if (command === "contact.reset") {
          const resolved = await resolveSingleContact(canonical!);
          if ("error" in resolved) {
            result = { ok: false, error: resolved.error };
            httpStatus = resolved.error === "contact_lookup_failed" ? 500 : 404;
          } else {
            const actor = await pickAdminActor();
            if (!actor) {
              result = { ok: false, error: "no_admin_actor_available" };
              httpStatus = 503;
            } else {
              const { data, error } = await (supabaseAdmin as any).rpc("admin_reset_tamar", {
                p_contact_id: resolved.contactId,
                p_reason: `agent_command_bridge: ${reason}`.slice(0, 480),
                p_reset_intake: true,
                p_actor: actor,
                p_correlation: correlationId,
              });
              if (error) {
                result = { ok: false, error: "reset_failed" };
                httpStatus = 500;
              } else {
                result = { ok: true, command, ...sanitizeResetResult(data) };
              }
            }
          }
        } else if (command === "crm.patch_contact") {
          const { data, error } = await (supabaseAdmin as any).rpc("zooga_agent_patch_contact", {
            _gateway_token: token,
            _phone: canonical,
            _status: patch!.status,
            _conversation_state: patch!.conversationState,
            _reason: reason,
          });
          if (error) {
            result = { ok: false, error: "patch_failed" };
            httpStatus = 500;
          } else if (data?.ok !== true) {
            result = { ok: false, error: String(data?.error ?? "patch_rejected") };
            httpStatus = data?.error === "contact_not_found" ? 404 : 400;
          } else {
            result = {
              ok: true,
              command,
              changed: Boolean(data.changed),
              before: data.before,
              after: { status: data.after?.status, conversation_state: data.after?.conversation_state },
            };
          }
        } else {
          // tamar.redeploy — queues a request for a human publish. Never deploys.
          const { error } = await supabaseAdmin.from("zooga_deploy_requests").insert({
            idempotency_key: idempotencyKey,
            reason,
            correlation_id: correlationId,
          });
          result = error
            ? { ok: false, error: "deploy_request_failed", accepted: false, deployed: false }
            : {
                ok: true,
                command,
                accepted: true,
                deployed: false,
                status: "awaiting_human_publish",
              };
          if (error) httpStatus = 500;
        }

        await supabaseAdmin
          .from("zooga_agent_commands")
          .update({
            status: result.ok === true ? "completed" : "failed",
            result: result as any,
            completed_at: new Date().toISOString(),
          })
          .eq("id", claimed.id);

        return json({ ...result, correlation_id: correlationId, duplicate: false }, httpStatus);
      },
    },
  },
});
