/**
 * VOICE PIPELINE — stage-level observability regressions.
 *
 * Production evidence: recent webhook logs contained only text messages, yet
 * the runtime could not distinguish "no audio arrived" from "transcription
 * failed". These tests pin the distinction and the safety of stage details.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { inboundReceipt, safeDetail, stageEvent, failureClass } from "@/lib/voice/stages";

const inserted: any[] = [];
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (rows: any) => {
        inserted.push({ table, rows });
        return { error: null };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  },
}));

beforeEach(() => {
  inserted.length = 0;
});

describe("inbound receipt", () => {
  it("marks a text message as no-audio without inventing a voice failure", () => {
    const r = inboundReceipt({ wamid: "wamid.text.1", type: "text" });
    expect(r.has_audio).toBe(false);
    expect(r.has_media_id).toBe(false);
    expect(r.message_type).toBe("text");
  });

  it("records audio presence, media id and mime for a voice note", () => {
    const r = inboundReceipt({
      wamid: "wamid.voice.1",
      type: "audio",
      audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus" },
    });
    expect(r.has_audio).toBe(true);
    expect(r.has_media_id).toBe(true);
    expect(r.mime_type).toContain("audio/ogg");
  });
});

describe("stage details never leak secrets or media urls", () => {
  it("redacts tokens and temporary media urls", () => {
    expect(safeDetail("Bearer EAAG123abcXYZ")).toBe("[redacted]");
    expect(safeDetail("failed https://lookaside.fbsbx.com/x?access_token=abc")).not.toContain(
      "lookaside",
    );
    expect(safeDetail(null)).toBeNull();
  });

  it("maps stages to stable failure classes", () => {
    expect(failureClass("media_download")).toBe("media_download_failed");
    expect(failureClass("transcription")).toBe("transcription_failed");
  });
});

describe("transcribeInboundVoice", () => {
  it("returns no_audio and writes no voice_transcripts row when audio is absent", async () => {
    const { transcribeInboundVoice } = await import("@/lib/voice/transcription.server");
    const res = await transcribeInboundVoice({
      contactId: "c1",
      waMessageId: "wamid.text.2",
      mediaId: "",
      mime: null,
    });
    expect(res.status).toBe("no_audio");
    expect(res.error).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it("records an audio_received stage as soon as a media id exists", () => {
    const ev = stageEvent("audio_received", "ok", "audio/ogg");
    expect(ev.stage).toBe("audio_received");
    expect(ev.status).toBe("ok");
  });
});

describe("recordVoiceStages", () => {
  it("persists one ordered, safe row per stage", async () => {
    const { recordVoiceStages } = await import("@/lib/voice/stages.server");
    const ok = await recordVoiceStages({
      inboundMessageId: "wamid.voice.2",
      contactId: "c1",
      events: [
        stageEvent("audio_received", "ok", "audio/ogg"),
        stageEvent("transcription", "failed", "Bearer secret-token"),
      ],
      receipt: { has_audio: true },
    });
    expect(ok).toBe(true);
    const rows = inserted[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].payload.stage_index).toBe(0);
    expect(rows[1].payload.failure_class).toBe("transcription_failed");
    expect(JSON.stringify(rows)).not.toContain("secret-token");
  });
});
