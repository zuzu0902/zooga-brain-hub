import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assertAdminRole } from "@/lib/relationship-insights/authz";

describe("relationship insights — admin authorization", () => {
  const sb = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });

  it("allows an admin", async () => {
    await expect(assertAdminRole(sb(true), "u1")).resolves.toBeUndefined();
  });
  it("blocks a non-admin", async () => {
    await expect(assertAdminRole(sb(false), "u1")).rejects.toThrow("forbidden");
  });
  it("blocks when the role check itself fails", async () => {
    await expect(assertAdminRole(sb(null, { message: "boom" }), "u1")).rejects.toThrow(
      "authorization_check_failed",
    );
  });
});

const CURRENT = {
  status: "ok",
  version: 3,
  confidence: 72,
  generated_at: "2026-01-01T10:00:00.000Z",
  summary_he: "תקציר פנימי לצוות",
  sections: [
    {
      key: "needs_boundaries",
      label: "צרכים וגבולות",
      items: [{ text: "חשוב לה כנות", certainty: "explicit_fact", evidence_keys: ["dealbreakers"] }],
    },
  ],
  section_confidence: { needs_boundaries: 90 },
  contradictions: [],
  missing_info: [{ question_key: "occupation" }],
  matching_tags: [{ tag: "ללא נישואין" }],
  error: null,
};

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => ({}),
  createMiddleware: () => ({ server: () => ({}), client: () => ({}) }),
  createServerFn: () => {
    const chain: any = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: () => async () => ({}),
    };
    return chain;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQuery: () => ({ data: { current: CURRENT, history: [], stale: false, has_answers: true } }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

describe("relationship insights — RTL card rendering", () => {
  it("renders the Hebrew RTL card with status, confidence and evidence", async () => {
    const { RelationshipAiInsightsCard } = await import("@/components/relationship-ai-insights-card");
    const html = renderToStaticMarkup(<RelationshipAiInsightsCard contactId="c1" />);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("תובנות AI לזוגיות");
    expect(html).toContain("פנימי — לצוות בלבד");
    expect(html).toContain("רענן תובנות AI");
    expect(html).toContain("72%");
    expect(html).toContain("תקציר פנימי לצוות");
    expect(html).toContain("צרכים וגבולות"); // collapsible section header
    expect(html).toContain("90%"); // per-section confidence
    expect(html).toContain("occupation"); // missing info
    expect(html).toContain("אינו אבחון");
  });
});