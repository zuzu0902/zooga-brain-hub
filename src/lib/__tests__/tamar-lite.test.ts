import { describe, it, expect } from "vitest";
import { reduceLite } from "@/lib/tamar-lite/reducer";
import { selectLiteOffers, isLitePurchasable } from "@/lib/tamar-lite/sales-selector";
import { noopLiteAdapter } from "@/lib/tamar-lite/ai-adapter";
import { DEFAULT_INTAKE_FIELDS } from "@/lib/onboarding/baseline-intake";
import type { LiteConversation, LiteInbound } from "@/lib/tamar-lite/types";

const conv = (over: Partial<LiteConversation> = {}): LiteConversation => ({
  contact_id: "c1",
  phase: "intake",
  current_question_key: null,
  version: 3,
  last_inbound_wamid: null,
  last_outbound_key: null,
  human_owned: false,
  ...over,
});

const inbound = (over: Partial<LiteInbound> = {}): LiteInbound => ({
  wamid: "wamid.1",
  text: "שלום",
  meta_timestamp: "2026-08-17T09:00:00Z",
  source_type: "text",
  is_opt_out: false,
  is_handoff_request: false,
  is_direct_question: false,
  is_topic_shift: false,
  consent_granted: false,
  ...over,
});

const fact = (v: string): any => ({
  field_key: "x",
  value_text: v,
  explicit_or_inferred: "explicit",
  confidence: 100,
  source: "test",
  source_message_id: null,
  evidence: null,
  observed_at: new Date().toISOString(),
});

const base = {
  conversation: conv(),
  defs: DEFAULT_INTAKE_FIELDS,
  snapshot: { facts: {} as Record<string, any>, skipped: [] as string[] },
  consentGranted: true,
  optedOut: false,
  humanOwned: false,
  offerCandidates: [] as string[],
};

describe("tamar lite reducer — deterministic, shadow only", () => {
  it("asks for consent before anything else", () => {
    const d = reduceLite({ ...base, consentGranted: false, inbound: inbound() });
    expect(d.action.kind).toBe("ask_consent");
    expect(d.state_after.phase).toBe("awaiting_consent");
  });

  it("opt-out stops everything", () => {
    const d = reduceLite({ ...base, inbound: inbound({ is_opt_out: true }) });
    expect(d.action.kind).toBe("stop");
    expect(d.state_after.phase).toBe("opted_out");
    expect(d.action.outbound_key).toBeNull();
  });

  it("handoff is deterministic and never drafts an outbound", () => {
    const d = reduceLite({ ...base, inbound: inbound({ is_handoff_request: true }) });
    expect(d.action.kind).toBe("handoff");
    expect(d.state_after.human_owned).toBe(true);
    expect(d.action.outbound_key).toBeNull();
  });

  it("a known city/region is never asked again", () => {
    const d = reduceLite({
      ...base,
      snapshot: { facts: { first_name: fact("אורלי"), city: fact("רמלה"), region: fact("השפלה") }, skipped: [] },
      inbound: inbound(),
    });
    expect(d.action.question_key).not.toBe("city");
    expect(d.action.question_key).not.toBe("region");
  });

  it("a direct question wins over the intake question and resumes the missing field", () => {
    const d = reduceLite({ ...base, inbound: inbound({ is_direct_question: true, text: "כמה זה עולה?" }) });
    expect(d.action.kind).toBe("answer_question_then_resume");
    expect(d.action.resume_question_key).toBeTruthy();
    expect(d.state_after.current_question_key).toBe(d.action.resume_question_key);
  });

  it("topic shift also defers the intake, then resumes", () => {
    const d = reduceLite({ ...base, inbound: inbound({ is_topic_shift: true }) });
    expect(d.action.kind).toBe("answer_question_then_resume");
  });

  it("is idempotent for the same inbound: same key, same decision", () => {
    const a = reduceLite({ ...base, inbound: inbound() });
    const b = reduceLite({ ...base, inbound: inbound() });
    expect(a.action.outbound_key).toBe(b.action.outbound_key);
    expect(a).toEqual(b);
  });

  it("two fast messages produce distinct outbound keys and bump the version", () => {
    const a = reduceLite({ ...base, inbound: inbound({ wamid: "w1" }) });
    const b = reduceLite({ ...base, conversation: a.state_after, inbound: inbound({ wamid: "w2" }) });
    expect(a.action.outbound_key).not.toBe(b.action.outbound_key);
    expect(b.state_after.version).toBe(a.state_after.version + 1);
  });

  it("never returns a send instruction — outbox keys only", () => {
    const kinds = [
      reduceLite({ ...base, inbound: inbound() }).action.kind,
      reduceLite({ ...base, consentGranted: false, inbound: inbound() }).action.kind,
    ];
    expect(kinds.every((k) => k !== ("send" as any))).toBe(true);
  });

  it("moves to sales once baseline is complete and candidates exist", () => {
    const facts = Object.fromEntries(
      DEFAULT_INTAKE_FIELDS.filter((d) => d.stage !== "progressive").map((d) => [d.field_key, fact("x")]),
    );
    const d = reduceLite({
      ...base,
      inbound: inbound(),
      snapshot: { facts, skipped: [] },
      offerCandidates: ["o1", "o2", "o3", "o4"],
    });
    expect(["present_offers", "ask_intake_question"]).toContain(d.action.kind);
    if (d.action.kind === "present_offers") expect(d.action.offer_ids).toHaveLength(3);
  });
});

const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 30 * 864e5).toISOString();
const offer = (over: any = {}) => ({
  id: "o1",
  status: "active",
  event_date: future,
  event_end_date: future,
  landing_page_url: "https://x.co/o1",
  ...over,
});

describe("tamar lite sales selector", () => {
  const profile = { interests: [], region: null, prefers_abroad: null, style: null, previously_offered: [] };

  it("excludes expired, inactive, archived, sold out and link-less offers", () => {
    const offers = [
      offer({ id: "expired", event_date: past, event_end_date: past }),
      offer({ id: "inactive", status: "draft" }),
      offer({ id: "archived", archived_at: past }),
      offer({ id: "soldout", sold_out: true }),
      offer({ id: "nolink", landing_page_url: null, purchase_url: null }),
      offer({ id: "ok" }),
    ];
    expect(selectLiteOffers(offers, profile).map((c) => c.offer_id)).toEqual(["ok"]);
  });

  it("does not re-offer without a new reason", () => {
    const offers = [offer({ id: "seen" }), offer({ id: "fresh" })];
    expect(
      selectLiteOffers(offers, { ...profile, previously_offered: ["seen"] }).map((c) => c.offer_id),
    ).toEqual(["fresh"]);
    const again = selectLiteOffers(offers, {
      ...profile,
      previously_offered: ["seen"],
      new_reason_offer_ids: ["seen"],
    });
    expect(again.map((c) => c.offer_id)).toContain("seen");
  });

  it("ranks by interests, region and domestic/abroad and caps at 3", () => {
    const offers = [
      offer({ id: "a", tags: ["טיולים"], region: "שפלה", is_abroad: false }),
      offer({ id: "b" }),
      offer({ id: "c" }),
      offer({ id: "d" }),
    ];
    const res = selectLiteOffers(offers, {
      ...profile,
      interests: ["טיולים"],
      region: "שפלה",
      prefers_abroad: false,
    });
    expect(res[0]?.offer_id).toBe("a");
    expect(res[0]?.match_facts).toContain("interest:טיולים");
    expect(res.length).toBeLessThanOrEqual(3);
  });

  it("purchasability mirrors the sellable rule", () => {
    expect(isLitePurchasable(offer())).toBe(true);
    expect(isLitePurchasable(offer({ event_end_date: past }))).toBe(false);
  });
});

describe("tamar lite ai adapter boundary", () => {
  it("stage 1 adapter makes no model call and cannot change state", async () => {
    const out = await noopLiteAdapter.extractAndDraft({
      text: "היי",
      transcript: [],
      known_facts: {},
      question_key: null,
      question_text: null,
      offer_ids: [],
    });
    expect(out.draft).toBeNull();
    expect(out.facts).toEqual({});
    expect(out.model_metadata.called).toBe(false);
    expect(Object.keys(out)).toEqual(["facts", "draft", "model_metadata"]);
  });
});

describe("tamar lite has no send path", () => {
  it("no tamar-lite module imports a WhatsApp sender", async () => {
    const fs = await import("node:fs");
    const dir = "src/lib/tamar-lite";
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const src = fs.readFileSync(`${dir}/${f}`, "utf8");
      expect(src).not.toMatch(/sendWhatsApp|whatsapp-meta\.server|graph\.facebook\.com/);
    }
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("tamar lite stage 1 hardening", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("commits conversation + decision + processed in one atomic RPC", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("tamar_lite_commit_decision");
    // no separate decision write and no separate processed flag
    expect(src).not.toMatch(/from\("tamar_lite_decisions"\)/);
    expect(src).not.toMatch(/processing_state: "processed"/);
    expect(src).not.toContain("saveConversation");
  });

  it("a conflict never writes a decision and never marks the event processed", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toMatch(/if \(commit\?\.committed\) processed\+\+/);
    expect(src).toMatch(/conflicts\+\+/);
  });

  it("failures are bounded and the event is never lost", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("MAX_ATTEMPTS");
    expect(src).toMatch(/attempts >= MAX_ATTEMPTS \? "failed" : "pending"/);
  });

  it("sales reads offers_sellable and real offer history", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain('from("offers_sellable")');
    expect(src).not.toMatch(/from\("offers"\)/);
    expect(src).toContain("previously_offered: previouslyOffered");
  });

  it("parses previously offered ids from both shapes", async () => {
    const { extractPreviouslyOffered } = await import("@/lib/tamar-lite/processor.server");
    expect(extractPreviouslyOffered(["a", { offer_id: "b" }, { id: "c" }, 7])).toEqual(["a", "b", "c"]);
    expect(extractPreviouslyOffered(null)).toEqual([]);
  });

  it("duplicate provider_event_id increments real telemetry", async () => {
    const src = await read("src/lib/tamar-lite/events.server.ts");
    expect(src).toContain("tamar_lite_bump_duplicate");
    expect(src).toContain("tamar_lite_attach_contact");
  });

  it("the webhook links the event to the contact and processes in shadow, swallowing errors", async () => {
    const src = await read("src/routes/api/public/webhook/tamar.ts");
    expect(src).toContain("attachLiteEvent");
    expect(src).toContain("processLiteBacklog");
    expect(src).toContain("webhook_shadow_process");
  });

  it("nothing in tamar-lite writes to the outbox or calls a model", async () => {
    const fs = await import("node:fs");
    for (const f of fs.readdirSync("src/lib/tamar-lite")) {
      const src = fs.readFileSync(`src/lib/tamar-lite/${f}`, "utf8");
      expect(src).not.toMatch(/from\("tamar_lite_outbox"\)/);
      expect(src).not.toMatch(/lovable|openai|ai_gateway|generateText/i);
    }
  });
});
describe("tamar lite stage 1 — ordering, recovery, types", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("claims through the atomic per-contact RPC, not a plain pending scan", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("tamar_lite_claim_next");
    expect(src).not.toMatch(/processing_state: "processing"/);
    expect(src).not.toMatch(/\.eq\("processing_state", "pending"\)/);
  });

  it("never processes an event without a contact", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("if (!contactIdGuard)");
  });

  it("a rejected commit is not counted as processed", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("commit_rejected");
  });

  it("failure path clears the worker/lease markers so a restart can recover", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("processing_started_at: null");
    expect(src).toContain("worker_id: null");
  });

  it("maps offers_sellable columns that really exist", async () => {
    const { toLiteOffer } = await import("@/lib/tamar-lite/processor.server");
    const o = toLiteOffer({
      id: "11111111-1111-1111-1111-111111111111",
      status: "active",
      offer_url: "https://x.co/a",
      target_region: "שפלה",
      matching_tags: ["טיולים"],
      target_interests: ["מוזיקה"],
      event_date: future,
      event_end_date: future,
    });
    expect(o.landing_page_url).toBe("https://x.co/a");
    expect(o.region).toBe("שפלה");
    expect(o.tags).toEqual(["טיולים", "מוזיקה"]);
    expect(isLitePurchasable(o)).toBe(true);
  });

  it("only message events enter the pending backlog; status/unknown are final 'recorded'", async () => {
    const src = await read("src/lib/tamar-lite/events.server.ts");
    expect(src).toContain('input.kind === "message" ? "pending" : "recorded"');
  });

  it("backlog telemetry counts only pending message events", async () => {
    const src = await read("src/lib/tamar-lite.functions.ts");
    expect(src).toContain('count("pending", true)');
    expect(src).toContain('q.eq("event_kind", "message")');
  });

  it("each backlog run gets a unique fencing worker token", async () => {
    const { makeWorkerToken } = await import("@/lib/tamar-lite/processor.server");
    const a = makeWorkerToken("webhook-shadow:wamid.X");
    const b = makeWorkerToken("webhook-shadow:wamid.X");
    expect(a).not.toBe(b);
    expect(a.startsWith("webhook-shadow:wamid.X:")).toBe(true);
  });

  it("commit passes the worker token and failure only releases our own lease", async () => {
    const src = await read("src/lib/tamar-lite/processor.server.ts");
    expect(src).toContain("p_worker_id: worker");
    expect(src).toContain('.eq("worker_id", worker)');
  });
});
