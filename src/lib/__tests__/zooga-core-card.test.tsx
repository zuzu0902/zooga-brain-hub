import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyStatus, type GatewayStatus } from "@/lib/zooga-gateway/status";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));
vi.mock("@/lib/language-context", () => ({ useT: () => (s: string) => s }));

import { ZoogaCoreCard } from "@/components/zooga-core-card";

const ONLINE: GatewayStatus = {
  reachable: true,
  checked_at: "2026-08-24T08:00:00.000Z",
  latency_ms: 55,
  system: "zooga-gateway",
  environment: "production",
  tenant: "zooga",
  live_traffic: false,
  inbound_enabled: false,
  outbound_enabled: false,
  integrations: { supabase: true, whatsapp: false, meta: false },
  error_code: null,
};

describe("ZoogaCoreCard", () => {
  it("renders the expected all-OFF safety state", () => {
    const html = renderToStaticMarkup(<ZoogaCoreCard initialStatus={ONLINE} />);
    expect(html).toContain("ליבת Zooga");
    expect(html).toContain("production");
    expect(html).toContain("55 ms");
    expect((html.match(/>OFF</g) ?? []).length).toBe(3);
    expect(html).not.toContain(">ON<");
    expect(html).toContain('dir="rtl"');
  });

  it("shows a non-sensitive error code when the gateway is unavailable", () => {
    const html = renderToStaticMarkup(
      <ZoogaCoreCard initialStatus={emptyStatus("2026-08-24T08:00:00.000Z", "forbidden")} />,
    );
    expect(html).toContain("forbidden");
    expect((html.match(/>OFF</g) ?? []).length).toBe(3);
  });

  it("renders no activation controls", () => {
    const html = renderToStaticMarkup(<ZoogaCoreCard initialStatus={ONLINE} />);
    expect(html).not.toMatch(/הפעל|activate/i);
  });
});
