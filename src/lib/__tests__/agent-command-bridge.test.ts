/**
 * Agent Command Bridge contract tests.
 *
 * Covers: supported command surface, prohibited patch fields, phone handling,
 * idempotency claim ordering (no mutation before the key is claimed),
 * sanitized output, and the truthful non-deploying tamar.redeploy behavior.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONVERSATION_STATE,
  ALLOWED_PATCH_FIELDS,
  ALLOWED_STATUS,
  SUPPORTED_COMMANDS,
  canonicalIsraeliPhone,
  extractBearerToken,
  maskPhone,
  phoneVariants,
  sanitizeResetResult,
  validatePatch,
} from "@/routes/api/public/runtime/agent-command";

const SRC = readFileSync("src/routes/api/public/runtime/agent-command.ts", "utf8");
const TURN_SRC = readFileSync("src/routes/api/public/runtime/tamar-turn.ts", "utf8");
const WEBHOOK_SRC = readFileSync("src/routes/api/public/webhook/tamar.ts", "utf8");

function migrationSql(): string {
  const roots = ["drizzle/migrations", "supabase/migrations"].filter((d) => {
    try {
      readdirSync(d);
      return true;
    } catch {
      return false;
    }
  });
  return roots
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(d, f), "utf8")))
    .join("\n");
}

describe("command surface", () => {
  it("supports exactly the three approved commands", () => {
    expect([...SUPPORTED_COMMANDS]).toEqual(["contact.reset", "crm.patch_contact", "tamar.redeploy"]);
  });

  it("rejects an unknown or third command", () => {
    for (const cmd of ["sql.run", "contact.delete", "shell.exec", "tamar.reset", ""]) {
      expect((SUPPORTED_COMMANDS as readonly string[]).includes(cmd)).toBe(false);
    }
    expect(SRC).toContain('error: "unsupported_command"');
  });

  it("offers no arbitrary SQL, shell or secret read surface", () => {
    for (const banned of ["child_process", "run_sql", "process.env[", "execSync"]) {
      expect(SRC).not.toContain(banned);
    }
    expect(SRC).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe("auth scoping", () => {
  it("validates the gateway credential only through the database digest RPC", () => {
    expect(SRC).toContain("zooga_core_gateway_authorized");
    expect(SRC).toContain('error: "unauthorized"');
    expect(extractBearerToken("Bearer " + "x".repeat(40))).toBe("x".repeat(40));
    expect(extractBearerToken("Bearer short")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it("does not weaken other routes", () => {
    expect(WEBHOOK_SRC).toContain("x-hub-signature-256");
    expect(WEBHOOK_SRC).not.toContain("zooga_core_gateway_authorized");
    expect(TURN_SRC).toContain("zooga_core_gateway_authorized");
    expect(TURN_SRC).not.toContain("agent-command");
  });
});

describe("crm.patch_contact validation", () => {
  it("accepts only status and conversation_state enum values", () => {
    expect([...ALLOWED_PATCH_FIELDS]).toEqual(["status", "conversation_state"]);
    expect(validatePatch({ status: "customer" })).toEqual({
      ok: true,
      status: "customer",
      conversationState: null,
    });
    expect(validatePatch({ conversation_state: "consented" })).toEqual({
      ok: true,
      status: null,
      conversationState: "consented",
    });
    expect(ALLOWED_STATUS).toContain("VIP");
    expect(ALLOWED_CONVERSATION_STATE).toContain("human_handoff_queued");
  });

  it("rejects role and every other prohibited field", () => {
    for (const field of ["role", "consent", "whatsapp_consent", "human_owned", "phone", "name"]) {
      expect(validatePatch({ [field]: "x" })).toEqual({ ok: false, error: "unsupported_field", field });
    }
  });

  it("rejects empty and invalid enum values", () => {
    expect(validatePatch({})).toEqual({ ok: false, error: "empty_patch" });
    expect(validatePatch(null)).toEqual({ ok: false, error: "invalid_patch" });
    expect(validatePatch({ status: "superuser" })).toEqual({ ok: false, error: "invalid_status" });
    expect(validatePatch({ conversation_state: "wat" })).toEqual({
      ok: false,
      error: "invalid_conversation_state",
    });
  });

  it("uses a narrowly scoped definer RPC that never touches consent or ownership", () => {
    const sql = migrationSql();
    const fn = sql.slice(sql.indexOf("FUNCTION public.zooga_agent_patch_contact"));
    expect(fn).toContain("zooga_core_gateway_authorized");
    expect(fn).toContain("UPDATE public.contacts SET");
    expect(fn).toContain("tamar_admin_audit_log");
    const update = fn.slice(fn.indexOf("UPDATE public.contacts SET"), fn.indexOf("WHERE id = v_contact.id"));
    expect(update).toContain("status =");
    expect(update).toContain("conversation_state =");
    for (const banned of ["consent", "human_owned", "phone", "role"]) {
      expect(update).not.toContain(banned);
    }
  });
});

describe("phone handling and sanitized output", () => {
  it("canonicalizes Israeli numbers and rejects junk", () => {
    expect(canonicalIsraeliPhone("0512277533")).toBe("972512277533");
    expect(canonicalIsraeliPhone("+972 51-227-7533")).toBe("972512277533");
    expect(canonicalIsraeliPhone("00972512277533")).toBe("972512277533");
    expect(canonicalIsraeliPhone("123")).toBeNull();
    expect(canonicalIsraeliPhone(null)).toBeNull();
    expect(phoneVariants("972512277533")).toEqual(["+972512277533", "972512277533", "0512277533"]);
  });

  it("never returns a full phone number or free text", () => {
    expect(maskPhone("972512277533")).toBe("***7533");
    expect(sanitizeResetResult({ ok: true, jobs_cancelled: 2, note: "לקוח אמר שלום" })).toEqual({
      ok: true,
      jobs_cancelled: 2,
    });
  });

  it("resolves exactly one contact or fails", () => {
    expect(SRC).toContain('error: "ambiguous_phone"');
    expect(SRC).toContain('error: "contact_not_found"');
  });
});

describe("contact.reset safety", () => {
  it("calls the existing definer reset with reset_intake and a real admin actor", () => {
    expect(SRC).toContain('rpc("admin_reset_tamar"');
    expect(SRC).toContain("p_reset_intake: true");
    expect(SRC).toContain("pickAdminActor");
    expect(SRC).toContain('error: "no_admin_actor_available"');
    expect(SRC).toContain("p_correlation: correlationId");
  });
});

describe("idempotency", () => {
  it("claims the key before any mutation and replays the prior result", () => {
    const claim = SRC.indexOf('from("zooga_agent_commands")');
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(SRC.indexOf('rpc("admin_reset_tamar"'));
    expect(claim).toBeLessThan(SRC.indexOf('rpc("zooga_agent_patch_contact"'));
    expect(claim).toBeLessThan(SRC.indexOf('from("zooga_deploy_requests")'));
    expect(SRC).toContain("duplicate: true");
    expect(SRC).toContain('error: "idempotency_key_conflict"');
  });

  it("enforces uniqueness in the database", () => {
    const sql = migrationSql();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.zooga_agent_commands");
    expect(sql).toMatch(/zooga_agent_commands[\s\S]*idempotency_key text NOT NULL UNIQUE/);
    expect(sql).toMatch(/zooga_deploy_requests[\s\S]*idempotency_key text NOT NULL UNIQUE/);
  });
});

describe("tamar.redeploy never deploys", () => {
  it("queues an audited request awaiting a human publish", () => {
    expect(SRC).toContain('status: "awaiting_human_publish"');
    expect(SRC).toContain("deployed: false");
    expect(SRC).not.toContain("deployed: true");
    expect(SRC).not.toMatch(/\/v1\/projects\/.*\/publish/);
    expect(SRC.toLowerCase()).not.toContain("lovable_api_key");
    const sql = migrationSql();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.zooga_deploy_requests");
    expect(sql).toContain("'awaiting_human_publish'");
  });
});

describe("request limits", () => {
  it("caps body size and required field lengths", () => {
    expect(SRC).toContain('error: "payload_too_large"');
    expect(SRC).toContain('error: "idempotency_key_required"');
    expect(SRC).toContain('error: "reason_required"');
  });
});
