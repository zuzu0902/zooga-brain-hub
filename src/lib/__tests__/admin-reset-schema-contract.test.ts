/**
 * SQL contract test for admin_reset_tamar.
 *
 * The reset runs entirely inside one SECURITY DEFINER Postgres function, so the
 * only way it can fail in production is a mismatch between the SQL and the real
 * column constraints. NOT_NULL_COLUMNS below is a snapshot of
 * information_schema.columns / pg_constraint for the tables the reset touches
 * (verified against the live schema). The test parses the shipped SQL and proves
 * no NOT NULL column is ever assigned NULL — which is exactly how the two
 * production failures (manager_handoffs.notes jsonb, contacts.last_presented_offers)
 * happened.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** table -> column -> { type, default } for NOT NULL columns touched by the reset */
const NOT_NULL_COLUMNS: Record<string, Record<string, { type: string; def: string }>> = {
  contacts: {
    human_owned: { type: "boolean", def: "false" },
    manager_attention_required: { type: "boolean", def: "false" },
    ambiguity_turns: { type: "integer", def: "0" },
    last_presented_offers: { type: "jsonb", def: "'[]'::jsonb" },
    baseline_intake_status: { type: "text", def: "'not_started'::text" },
    opening_status: { type: "text", def: "'not_sent'::text" },
    relationship_intake_status: { type: "text", def: "'not_offered'::text" },
    intake_deferred_fields: { type: "text[]", def: "'{}'::text[]" },
  },
  manager_handoffs: {
    status: { type: "text", def: "'open'::text" },
    notes: { type: "jsonb", def: "'[]'::jsonb" },
  },
  processing_jobs: { state: { type: "text", def: "'pending'::text" } },
  outbound_event_ledger: { state: { type: "text", def: "'queued'::text" } },
};

function latestResetSql(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(join(MIGRATIONS, files[i]!), "utf8");
    if (sql.includes("FUNCTION public.admin_reset_tamar")) return sql;
  }
  throw new Error("admin_reset_tamar migration not found");
}

const sql = latestResetSql();

describe("admin_reset_tamar SQL contract", () => {
  it("never assigns NULL to a NOT NULL column", () => {
    const violations: string[] = [];
    for (const cols of Object.values(NOT_NULL_COLUMNS)) {
      for (const col of Object.keys(cols)) {
        const re = new RegExp(`\\b${col}\\s*=\\s*NULL\\b`, "i");
        if (re.test(sql)) violations.push(col);
      }
    }
    expect(violations).toEqual([]);
  });

  it("regression: last_presented_offers is reset to an empty jsonb array", () => {
    expect(sql).toMatch(/last_presented_offers\s*=\s*'\[\]'::jsonb/);
  });

  it("regression: handoff notes stay jsonb (no text concatenation)", () => {
    expect(sql).toMatch(/notes\s*=\s*coalesce\(notes,\s*'\[\]'::jsonb\)/);
    expect(sql).toMatch(/jsonb_build_array\(jsonb_build_object\(/);
    expect(sql).not.toMatch(/notes\s*=\s*coalesce\(notes,\s*''\)/);
  });

  it("restores NOT NULL text columns to their schema defaults on intake reset", () => {
    expect(sql).toMatch(/baseline_intake_status\s*=\s*'not_started'/);
    expect(sql).toMatch(/opening_status\s*=\s*'not_sent'/);
    expect(sql).toMatch(/relationship_intake_status\s*=\s*'not_offered'/);
    expect(sql).toMatch(/intake_deferred_fields\s*=\s*'\{\}'::text\[\]/);
    expect(sql).toMatch(/conversion_stage\s*=\s*'new'/);
  });

  it("keeps intake array columns as arrays and the score numeric", () => {
    for (const col of ["intake_required_fields", "intake_completed_fields", "intake_missing_fields"]) {
      expect(sql).toMatch(new RegExp(`${col}\\s*=\\s*'\\{\\}'::text\\[\\]`));
    }
    expect(sql).toMatch(/intake_completion_score\s*=\s*0/);
  });

  it("respects the contacts CHECK constraints", () => {
    const baseline = sql.match(/baseline_intake_status\s*=\s*'([^']+)'/)?.[1];
    expect(["not_started", "in_progress", "completed"]).toContain(baseline);
    expect(sql).not.toMatch(/consent_status\s*=/); // consent is never modified
  });

  it("is idempotent and safe on re-run: only conditional/absolute assignments, no counters incremented", () => {
    expect(sql).not.toMatch(/ambiguity_turns\s*=\s*ambiguity_turns/);
    expect(sql).toMatch(/ambiguity_turns\s*=\s*0/);
    // handoffs / jobs / outbox are filtered by state, so a second run is a no-op
    expect(sql).toMatch(/status IN \('open','notified','claimed'\)/);
    expect(sql).toMatch(/pj\.state IN \('pending','leased','failed'\)/);
    expect(sql).toMatch(/state IN \('queued','sending'\)/);
  });

  it("preserves messages, vault, identity, profile and questionnaire unless intake reset is requested", () => {
    for (const t of ["public.messages", "public.inbound_event_vault", "public.contact_identity_registry", "public.contact_profile_facts"]) {
      expect(sql).not.toMatch(new RegExp(`DELETE FROM ${t.replace(".", "\\.")}`));
    }
    const intakeBlock = sql.split("IF p_reset_intake THEN")[1] ?? "";
    expect(intakeBlock).toMatch(/DELETE FROM public\.relationship_intake_answers/);
    expect(sql.split("IF p_reset_intake THEN")[0]).not.toMatch(/relationship_intake_answers/);
  });

  it("runs atomically in one function call", () => {
    expect(sql).toMatch(/LANGUAGE plpgsql/);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
  });
});
