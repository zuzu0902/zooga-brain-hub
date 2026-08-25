import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyStatus, sanitizeGatewayStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));
vi.mock("@/lib/language-context", () => ({ useT: () => (s: string) => s }));
// The card links to the advanced readiness view; no router is mounted in this SSR test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));


import { ZoogaCoreCard } from "@/components/zooga-core-card";

// Built from the real Gateway payload through the sanitizer.
const ONLINE: GatewayStatus = sanitizeGatewayStatus(
  {
    system: "zooga-os",
    environment: "foundation",
    live_traffic: false,
    default_tenant: "zooga",
    integrations: { supabase: true, meta: false, lovable: true, llm: false },
    execution: { inbound_enabled: false, outbound_enabled: false },
    safety: { kill_switch: true },
  },
  { checkedAt: "2026-08-24T08:00:00.000Z", latencyMs: 55 },
);

describe("ZoogaCoreCard", () => {
  it("renders the expected all-OFF safety state", () => {
    const html = renderToStaticMarkup(<ZoogaCoreCard initialStatus={ONLINE} />);
    expect(html).toContain("ליבת Zooga");
    expect(html).toContain("foundation");
    expect(html).toContain("zooga");
    expect(html).toContain("55 ms");
    expect((html.match(/>OFF</g) ?? []).length).toBe(4);
    expect(html).not.toContain(">ON<");
    expect(html).toContain('dir="rtl"');
  });

  it("shows a non-sensitive error code when the gateway is unavailable", () => {
    const html = renderToStaticMarkup(
      <ZoogaCoreCard initialStatus={emptyStatus("2026-08-24T08:00:00.000Z", "forbidden")} />,
    );
    expect(html).toContain("forbidden");
    expect((html.match(/>OFF</g) ?? []).length).toBe(4);
  });

  it("renders no activation controls", () => {
    const html = renderToStaticMarkup(<ZoogaCoreCard initialStatus={ONLINE} />);
    expect(html).not.toMatch(/הפעל|activate/i);
  });
});
