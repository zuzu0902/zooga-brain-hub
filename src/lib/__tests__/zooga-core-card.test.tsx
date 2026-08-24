import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { emptyStatus } from "@/lib/zooga-gateway/status";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "t" } } }) } },
}));
vi.mock("@/lib/language-context", () => ({ useT: () => (s: string) => s }));

import { ZoogaCoreCard } from "@/components/zooga-core-card";

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

function mockStatus(body: any) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

describe("ZoogaCoreCard", () => {
  it("renders the all-OFF safety state", async () => {
    mockStatus({
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
    });
    render(<ZoogaCoreCard />);
    await waitFor(() => expect(screen.getByText("production")).toBeTruthy());
    expect(screen.getAllByText("OFF").length).toBe(3);
    expect(screen.queryByText("ON")).toBeNull();
    expect(screen.getByText("55 ms")).toBeTruthy();
  });

  it("shows an error code when the gateway is unauthorized/unreachable", async () => {
    mockStatus(emptyStatus("2026-08-24T08:00:00.000Z", "forbidden"));
    render(<ZoogaCoreCard />);
    await waitFor(() => expect(screen.getByTestId("zooga-core-error").textContent).toContain("forbidden"));
    expect(screen.getAllByText("OFF").length).toBe(3);
  });
});
