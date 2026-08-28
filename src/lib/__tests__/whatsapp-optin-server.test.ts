/**
 * Consent-opening route behaviour. Fully mocked — no network, no real data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
let contactRow: Row | null = null;
let updateAffects = true;
const updates: Row[] = [];
const sent: Array<{ kind: string; to: string }> = [];
let sessionOpen = false;

function builder(table: string) {
  const state: any = { table, op: "select", patch: null };
  const api: any = {
    select: () => api,
    eq: () => api,
    is: () => api,
    in: () => api,
    limit: () => api,
    insert: () => Promise.resolve({ data: null, error: null }),
    update: (patch: Row) => {
      state.op = "update";
      state.patch = patch;
      updates.push({ table, ...patch });
      return api;
    },
    maybeSingle: () => Promise.resolve({ data: table === "contacts" ? contactRow : null, error: null }),
    then: (res: any) =>
      Promise.resolve({
        data: state.op === "update" ? (updateAffects ? [{ id: "c1" }] : []) : null,
        error: null,
      }).then(res),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

vi.mock("@/lib/whatsapp-meta.server", () => ({
  sendWhatsAppTemplate: vi.fn(async (to: string) => {
    sent.push({ kind: "template", to });
    return { ok: true, provider_message_id: "wamid.test", status: 200, error: null };
  }),
  sendWhatsAppText: vi.fn(async (to: string) => {
    sent.push({ kind: "text", to });
    return { ok: true, provider_message_id: "wamid.text", status: 200, error: null };
  }),
  recordDelivery: vi.fn(async () => {}),
  isSessionWindowOpen: vi.fn(async () => sessionOpen),
}));

let allowlistAllowed = true;
vi.mock("@/lib/tamar-pilot/live-allowlist.server", () => ({
  assertLiveSendAllowed: vi.fn(async () => (allowlistAllowed
    ? { allowed: true, reason: "allowlist_hit", reason_he: "", phone: null }
    : { allowed: false, reason: "allowlist_blocked", reason_he: "חסום", phone: null })),
}));

const verifiedContact = () => ({
  id: "c1",
  phone: "+972550000001",
  whatsapp_number: "+972550000001",
  first_name: "פיקסצ׳ר",
  consent_marketing: false,
  opted_out_at: null,
  human_owned: false,
  opening_status: "not_sent",
  whatsapp_opt_in_status: "verified",
  whatsapp_opt_in_at: "2026-08-01T00:00:00Z",
  whatsapp_opt_in_source: "import_file",
});

beforeEach(() => {
  contactRow = verifiedContact();
  updateAffects = true;
  updates.length = 0;
  sent.length = 0;
  sessionOpen = false;
  allowlistAllowed = true;
});

describe("sendConsentOpening", () => {
  it("blocks a non-allowlisted number at the last gate and sends nothing", async () => {
    allowlistAllowed = false;
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1");
    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("allowlist_blocked");
    expect(sent).toHaveLength(0);
  });

  it("sends the approved template to a verified contact without marketing consent", async () => {
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1");
    expect(res.status).toBe("sent");
    expect(res.transport).toBe("template");
    expect(sent).toHaveLength(1);
    expect(updates.some((u) => u.opening_status === "asked")).toBe(true);
  });

  it("prefers the open service window when one exists", async () => {
    sessionOpen = true;
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1");
    expect(res.transport).toBe("session");
    expect(sent[0]!.kind).toBe("text");
  });

  it("blocks unknown opt-in with a clear reason and sends nothing", async () => {
    contactRow = { ...verifiedContact(), whatsapp_opt_in_status: "unknown" };
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1");
    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("no_opening_authorization");
    expect(sent).toHaveLength(0);
  });

  it("never sends twice — the claim update decides", async () => {
    updateAffects = false;
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1");
    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("opening_already_sent");
    expect(sent).toHaveLength(0);
  });

  it("dry run sends nothing", async () => {
    const { sendConsentOpening } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await sendConsentOpening("c1", { dryRun: true });
    expect(res.status).toBe("sent");
    expect(res.dry_run).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("applyConsentAnswer", () => {
  it("yes grants marketing consent and opens intake once", async () => {
    contactRow = { ...verifiedContact(), opening_status: "asked" };
    const { applyConsentAnswer } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await applyConsentAnswer({ contactId: "c1", text: "כן" });
    expect(res.handled).toBe(true);
    expect(res.reply_text).toContain("נוח לך לצ׳וטט");
    const patch = updates.find((u) => u.consent_marketing === true)!;
    expect(patch.whatsapp_opt_in_status).toBe("verified");
    expect(patch.baseline_intake_status).toBe("in_progress");
  });

  it("no revokes consent, marks denied and closes once", async () => {
    contactRow = { ...verifiedContact(), opening_status: "asked" };
    const { applyConsentAnswer } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await applyConsentAnswer({ contactId: "c1", text: "לא תודה" });
    const patch = updates.find((u) => u.whatsapp_opt_in_status === "denied")!;
    expect(patch.consent_marketing).toBe(false);
    expect(patch.opted_out_at).toBeTruthy();
    expect(res.reply_text).toBeTruthy();
  });

  it("a repeated answer replies nothing (no loops)", async () => {
    contactRow = { ...verifiedContact(), opening_status: "asked" };
    updateAffects = false;
    const { applyConsentAnswer } = await import("@/lib/whatsapp-optin/optin.server");
    const res = await applyConsentAnswer({ contactId: "c1", text: "כן" });
    expect(res.duplicate).toBe(true);
    expect(res.reply_text).toBeNull();
  });

  it("ignores answers when no consent question is open", async () => {
    contactRow = { ...verifiedContact(), opening_status: "not_sent" };
    const { applyConsentAnswer } = await import("@/lib/whatsapp-optin/optin.server");
    expect((await applyConsentAnswer({ contactId: "c1", text: "כן" })).handled).toBe(false);
  });
});