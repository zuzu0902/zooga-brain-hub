/**
 * Pilot Control Center server functions. Every entry point requires an
 * authenticated ADMIN (canonical has_role): the pilot surface exposes contact
 * data and can trigger real outreach. Sending actions are explicit, one
 * contact at a time, and still pass the canonical live allowlist server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Response("Forbidden", { status: 403 });
}

export const getPilotStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { pilotStatus } = await import("@/lib/tamar-pilot/pilot.server");
    return pilotStatus();
  });

export const importPilotBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    rows: Array<{ full_name?: string | null; phone?: string | null }>;
    fileName?: string | null;
    dryRun?: boolean;
  }) => {
    const rows = Array.isArray(input?.rows) ? input.rows.slice(0, 500) : [];
    if (!rows.length) throw new Error("no_rows");
    const fileName = String(input?.fileName ?? "").trim() || "pilot_paste";
    return { rows, fileName: fileName.slice(0, 200), dryRun: input?.dryRun === true };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { importPilotFile } = await import("@/lib/tamar-pilot/pilot.server");
    return importPilotFile({
      rows: data.rows,
      fileName: data.fileName,
      actorId: context.userId,
      dryRun: data.dryRun,
    });
  });

export const sendPilotOpener = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string; dryRun?: boolean }) => {
    const id = String(input?.contactId ?? "").trim();
    if (!UUID.test(id)) throw new Error("invalid_contact_id");
    return { contactId: id, dryRun: input?.dryRun !== false };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { launchPilotOpener } = await import("@/lib/tamar-pilot/pilot.server");
    return launchPilotOpener(data);
  });

export const runPilotLifecycleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dryRun?: boolean }) => ({ dryRun: input?.dryRun !== false }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runPilotLifecycle } = await import("@/lib/tamar-pilot/pilot.server");
    return runPilotLifecycle({ dryRun: data.dryRun });
  });

export const syncRelationshipStatusQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { ensureRelationshipStatusQuestion } = await import("@/lib/tamar-pilot/pilot.server");
    return ensureRelationshipStatusQuestion();
  });
