import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { createCoreClient, HOSTINGER_CORE_BASE_URL } from "@/lib/hostinger-core/client";
import { parseControlCenter, operatorLabel } from "@/lib/hostinger-core/control-center";

const response = { ok: true, control_center: { summary: { contacts: 45, active_conversations: 66, open_handoffs: 0, open_tasks: 1 }, conversations: [], handoffs: [], tasks: [], tamar: { shadow_by_state: { blocked: 2 } }, delivery: { outbound_by_state: { delivered: 1 } } }, readiness: { outbound_enabled: false } };
describe("operator Control Center", () => {
  it("makes only one read-only request using the current session bearer", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
    const client = createCoreClient({ getToken: async () => "session-token", fetcher });
    expect((await client.controlCenter()).control_center.summary.contacts).toBe(45);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${HOSTINGER_CORE_BASE_URL}/v1/admin/control-center`);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: "Bearer session-token" });
  });
  it("does not convert missing or malformed counts into false empty data", () => {
    expect(() => parseControlCenter({ ok: true })).toThrow("core_control_center_unavailable");
    expect(() => parseControlCenter({ ...response, control_center: { ...response.control_center, summary: { contacts: null } } })).toThrow();
  });
  it("accepts genuinely empty lists and disabled outbound readiness", () => {
    expect(parseControlCenter(response).control_center.handoffs).toEqual([]);
    expect(parseControlCenter(response).readiness?.outbound_enabled).toBe(false);
  });
  it("refuses unsigned reads without dispatching a request", async () => {
    const fetcher = vi.fn();
    await expect(createCoreClient({ getToken: async () => null, fetcher }).controlCenter()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses operator language and never prints unknown runtime codes", () => {
    expect(operatorLabel("delivered")).toBe("נמסרה");
    expect(operatorLabel("internal-debug-code")).toBe("לא ידוע");
  });
  it("daily routes have no legacy database, server-function or delivery imports", () => {
    const paths = ["src/routes/_app.index.tsx", "src/routes/_app.contacts.index.tsx", "src/routes/_app.contacts.$id.tsx", "src/routes/_app.inbox.tsx", "src/routes/_app.tasks.tsx", "src/routes/_app.handoff.tsx", "src/components/command-center.tsx", "src/components/operator-data.tsx", "src/components/operator-contact.tsx"];
    for (const path of paths) expect(readFileSync(path, "utf8"), path).not.toMatch(/supabase|fetchCanonicalContacts|useServerFn|gateway-campaign|ContactConversation|TamarActivationCard|MigrationVerificationPanel/);
  });
  it("keeps exactly the seven primary sections and technical items collapsed", () => {
    const shell = readFileSync("src/routes/_app.tsx", "utf8");
    const primary = shell.split("const PRIMARY_NAV: NavEntry[] = [")[1]?.split("const ADVANCED_NAV")[0] ?? "";
    for (const label of ["מרכז שליטה", "אנשים", "שיחות", "משימות", "קטלוג ומכירות", "WhatsApp", "הגדרות"]) expect(primary).toContain(`label: "${label}"`);
    expect(primary).not.toMatch(/runtime-trace|zero-loss|tamar-studio|tamar-brain|settings\/api/);
    expect(shell).toContain("defaultOpen={false}");
  });
});