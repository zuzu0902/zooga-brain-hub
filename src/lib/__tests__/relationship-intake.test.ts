import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELATIONSHIP_QUESTIONS,
  RELATIONSHIP_COMPLETION_TEXT,
  RELATIONSHIP_INTRO_TEXT,
  acknowledgment,
  buildConfirmationQuestion,
  composeTurnText,
  extractRelationshipFields,
  isSkipRequest,
  isUncertainTranscript,
  mentionsHumanAgent,
  needsFollowUp,
  nextRelationshipQuestion,
  readConfirmationReply,
  relationshipProgress,
  sortedQuestions,
  type RelationshipAnswer,
  type RelationshipSnapshot,
} from "@/lib/relationship-intake/questions";
import {
  MAX_AUDIO_BYTES,
  audioFormat,
  sanitizeForLog,
  validateInboundAudio,
} from "@/lib/voice/audio";
import { parseInboundMessages } from "@/lib/whatsapp-meta.server";

const answer = (key: string, over: Partial<RelationshipAnswer> = {}): RelationshipAnswer => ({
  question_key: key,
  raw_text: "תשובה",
  structured_value: {},
  source: "text",
  evidence_message_id: null,
  confidence: 90,
  skipped_by_user: false,
  answered_at: new Date().toISOString(),
  ...over,
});

const snap = (answers: RelationshipAnswer[]): RelationshipSnapshot => ({
  answers: Object.fromEntries(answers.map((a) => [a.question_key, a])),
});

describe("relationship questionnaire — approved content", () => {
  it("holds the 18 approved questions plus the closing question", () => {
    expect(DEFAULT_RELATIONSHIP_QUESTIONS).toHaveLength(19);
    expect(DEFAULT_RELATIONSHIP_QUESTIONS.filter((q) => q.is_final_question)).toHaveLength(1);
  });

  it("uses the exact approved wording", () => {
    const byKey = Object.fromEntries(DEFAULT_RELATIONSHIP_QUESTIONS.map((q) => [q.question_key, q.question_text]));
    expect(byKey["relationship_status"]).toBe(
      "מה הסטטוס הזוגי שלך כיום? לדוגמה: רווקות, גירושין, אלמנות, זוגיות או מצב אחר.",
    );
    expect(byKey["last_relationship"]).toBe(
      "כמה זמן נמשכה מערכת היחסים המשמעותית האחרונה שלך, ומתי היא הסתיימה?",
    );
    expect(byKey["readiness_feeling"]).toBe("איך מרגיש לך היום להיכנס למערכת יחסים חדשה?");
    expect(byKey["desired_relationship_type"]).toBe("איזה סוג של מערכת יחסים היית רוצה לבנות בתקופה הזו?");
    expect(byKey["desired_partner_gender"]).toBe(
      "את מי היית רוצה להכיר? אפשר לציין מגדר או כל העדפה אחרת שרלוונטית עבורך.",
    );
    expect(byKey["age_range"]).toBe("באיזה טווח גילאים היית רוצה להכיר?");
    expect(byKey["geography"]).toBe("באילו אזורים בארץ מתאים לך להכיר, ועד כמה יש מבחינתך גמישות גיאוגרפית?");
    expect(byKey["important_traits"]).toBe("אילו תכונות וערכים חשוב לך למצוא באדם שאיתו תיבנה מערכת יחסים?");
    expect(byKey["dealbreakers"]).toBe("האם יש תכונות, הרגלים או פערים שחשוב לך להימנע מהם בקשר?");
    expect(byKey["height"]).toBe("מה הגובה שלך?");
    expect(byKey["education"]).toBe("מהי רמת ההשכלה שלך, ובאילו תחומים למדת?");
    expect(byKey["children"]).toBe("האם יש לך ילדים? אם כן, כמה ובאילו גילאים — רק אם נוח לך לשתף.");
    expect(byKey["occupation"]).toBe("מה המקצוע שלך ובאיזה תחום נמצאת העבודה שלך כיום?");
    expect(byKey["lifestyle"]).toBe("איך נראה אורח החיים שלך ביום־יום, ומה אוהבים לעשות בזמן הפנוי?");
    expect(byKey["religiosity"]).toBe(
      "האם יש אורח חיים מסוים שחשוב לך בקשר, למשל חילוני, מסורתי, דתי או משהו אחר?",
    );
    expect(byKey["habits_preferences"]).toBe(
      "האם יש העדפות חשובות בנוגע לעישון, תזונה, בעלי חיים או הרגלי חיים אחרים?",
    );
    expect(byKey["future_plans"]).toBe("עד כמה חשובים לך נישואין, מגורים משותפים או ילדים בעתיד?");
    expect(byKey["relationship_values"]).toBe("מה לדעתך הופך מערכת יחסים למערכת יחסים טובה ומצליחה?");
    expect(byKey["anything_else"]).toBe(
      "האם יש עוד משהו שהיית רוצה לספר על עצמך, על האדם שהיית רוצה להכיר או על הציפיות שלך ממערכת יחסים וזוגיות?",
    );
  });

  it("uses the approved intro and completion texts", () => {
    expect(RELATIONSHIP_INTRO_TEXT.startsWith("מעולה, אשמח להכיר אותך קצת יותר.")).toBe(true);
    expect(RELATIONSHIP_INTRO_TEXT).toContain("אפשר לענות בכתיבה או בהודעה קולית");
    expect(RELATIONSHIP_COMPLETION_TEXT.startsWith("תודה ששיתפת אותי.")).toBe(true);
  });

  it("never offers a human agent in any questionnaire copy", () => {
    const all = [
      RELATIONSHIP_INTRO_TEXT,
      RELATIONSHIP_COMPLETION_TEXT,
      ...DEFAULT_RELATIONSHIP_QUESTIONS.map((q) => q.question_text),
      ...DEFAULT_RELATIONSHIP_QUESTIONS.map((q) => acknowledgment(q.question_key)),
      acknowledgment("height", { skipped: true }),
    ];
    for (const text of all) expect(mentionsHumanAgent(text)).toBe(false);
  });
});

describe("one question per turn, skip and resume", () => {
  it("asks the first question when nothing is answered", () => {
    const q = nextRelationshipQuestion(DEFAULT_RELATIONSHIP_QUESTIONS, snap([]));
    expect(q?.question_key).toBe("relationship_status");
  });

  it("resumes at the exact missing question", () => {
    const answered = DEFAULT_RELATIONSHIP_QUESTIONS.slice(0, 4).map((q) => answer(q.question_key));
    const q = nextRelationshipQuestion(DEFAULT_RELATIONSHIP_QUESTIONS, snap(answered));
    expect(q?.question_key).toBe("desired_partner_gender");
  });

  it("never re-asks a skipped question", () => {
    const s = snap([answer("relationship_status", { skipped_by_user: true, raw_text: null })]);
    expect(nextRelationshipQuestion(DEFAULT_RELATIONSHIP_QUESTIONS, s)?.question_key).toBe("last_relationship");
    expect(relationshipProgress(DEFAULT_RELATIONSHIP_QUESTIONS, s).skipped).toContain("relationship_status");
  });

  it("skips questions whose data is already known", () => {
    const s = snap([answer("relationship_status"), answer("last_relationship")]);
    expect(nextRelationshipQuestion(DEFAULT_RELATIONSHIP_QUESTIONS, s)?.question_key).toBe("readiness_feeling");
  });

  it("returns null only once every question is answered or skipped", () => {
    const all = sortedQuestions(DEFAULT_RELATIONSHIP_QUESTIONS).map((q) => answer(q.question_key));
    expect(nextRelationshipQuestion(DEFAULT_RELATIONSHIP_QUESTIONS, snap(all))).toBeNull();
    expect(relationshipProgress(DEFAULT_RELATIONSHIP_QUESTIONS, snap(all)).percent).toBe(100);
  });

  it("recognizes skip phrasings without pressure", () => {
    expect(isSkipRequest("דלג")).toBe(true);
    expect(isSkipRequest("לא רוצה לענות")).toBe(true);
    expect(isSkipRequest("מעדיפה לא לשתף")).toBe(true);
    expect(isSkipRequest("אני רווקה")).toBe(false);
  });

  it("acknowledges warmly and asks exactly one question", () => {
    const text = composeTurnText(acknowledgment("relationship_status"), "מה הגובה שלך?");
    expect(text.split("\n")).toHaveLength(2);
    expect(text.match(/\?/g)).toHaveLength(1);
  });
});

describe("multi-answer extraction and follow-up", () => {
  it("fills several questions from one answer", () => {
    const out = extractRelationshipFields("אני גרושה, גובה 165 ס\"מ, יש לי 2 ילדים ואני חילונית", "relationship_status");
    expect(out["relationship_status"]).toBeTruthy();
    expect(out["height"]?.value).toBe("165 ס״מ");
    expect(out["children"]?.value).toBe("2 ילדים");
    expect(out["religiosity"]?.value).toBe("חילונית");
  });

  it("keeps evidence and confidence on every extracted value", () => {
    const out = extractRelationshipFields("אני מחפשת גילאי 55 עד 65", "age_range");
    expect(out["age_range"]?.value).toBe("55-65");
    for (const v of Object.values(out)) {
      expect(v.evidence.length).toBeGreaterThan(0);
      expect(v.confidence).toBeGreaterThan(0);
    }
  });

  it("does not guess sensitive values that were not stated", () => {
    const out = extractRelationshipFields("נעים מאוד", "readiness_feeling");
    expect(out["children"]).toBeUndefined();
    expect(out["height"]).toBeUndefined();
    expect(out["religiosity"]).toBeUndefined();
  });

  it("asks a follow-up only when a material detail is missing", () => {
    expect(needsFollowUp("age_range", "מבוגר ממני")).toBeTruthy();
    expect(needsFollowUp("age_range", "בערך 50 עד 60")).toBeNull();
    expect(needsFollowUp("last_relationship", "היה קשר ארוך")).toBeTruthy();
    expect(needsFollowUp("last_relationship", "5 שנים, הסתיים לפני שנתיים")).toBeNull();
    expect(needsFollowUp("relationship_values", "כבוד הדדי")).toBeNull();
  });
});

describe("voice uncertainty and confirmation", () => {
  it("treats a text answer as certain", () => {
    expect(isUncertainTranscript({ transcript: "רווקה", confidence: null, source: "text" })).toBe(false);
  });

  it("flags low-confidence or unclear transcripts", () => {
    expect(isUncertainTranscript({ transcript: "רווקה", confidence: 0.3, source: "voice" })).toBe(true);
    expect(isUncertainTranscript({ transcript: "[לא ברור]", confidence: null, source: "voice" })).toBe(true);
    expect(isUncertainTranscript({ transcript: "", confidence: 0.99, source: "voice" })).toBe(true);
    expect(isUncertainTranscript({ transcript: "הזוגיות הסתיימה לפני שנתיים", confidence: 0.95, source: "voice" })).toBe(false);
  });

  it("builds one focused confirmation question", () => {
    const q = buildConfirmationQuestion("אמרת שהזוגיות האחרונה הסתיימה לפני כשנתיים");
    expect(q).toBe("רק כדי לוודא שהבנתי נכון — אמרת שהזוגיות האחרונה הסתיימה לפני כשנתיים?");
  });

  it("reads the confirmation reply", () => {
    expect(readConfirmationReply("כן")).toBe("yes");
    expect(readConfirmationReply("לא נכון")).toBe("no");
    expect(readConfirmationReply("בעצם לפני שלוש שנים")).toBeNull();
  });
});

describe("inbound audio parsing and validation", () => {
  const payload = (msg: any) => ({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PID" }, contacts: [], messages: [msg] } }] }],
  });

  it("parses an inbound voice note", () => {
    const [m] = parseInboundMessages(
      payload({
        id: "wamid.AUDIO1",
        from: "972501234567",
        type: "audio",
        audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", voice: true },
      }),
    );
    expect(m?.type).toBe("audio");
    expect(m?.audio?.id).toBe("MEDIA1");
    expect(m?.audio?.mime_type).toBe("audio/ogg; codecs=opus");
  });

  it("still parses text messages unchanged", () => {
    const [m] = parseInboundMessages(payload({ id: "wamid.T1", from: "972501234567", type: "text", text: { body: "היי" } }));
    expect(m?.text).toBe("היי");
    expect(m?.audio).toBeNull();
  });

  it("accepts supported audio and rejects anything else", () => {
    expect(validateInboundAudio({ mime: "audio/ogg; codecs=opus", bytes: 20000 }).ok).toBe(true);
    expect(validateInboundAudio({ mime: "video/mp4", bytes: 20000 })).toEqual({ ok: false, reason: "unsupported_mime" });
    expect(validateInboundAudio({ mime: "audio/ogg", bytes: MAX_AUDIO_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
    expect(validateInboundAudio({ mime: "audio/ogg", bytes: 10 })).toEqual({ ok: false, reason: "too_small" });
    expect(validateInboundAudio({ mime: null, bytes: 1000 })).toEqual({ ok: false, reason: "missing" });
  });

  it("maps a mime type to the provider container format", () => {
    expect(audioFormat("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioFormat("audio/mp4")).toBe("m4a");
    expect(audioFormat("audio/mpeg")).toBe("mp3");
  });

  it("never leaks a temporary media URL or a token into a log line", () => {
    const line = sanitizeForLog(
      "failed https://lookaside.fbsbx.com/whatsapp/media?token=SECRETVALUE with Bearer EAAG123abc",
    );
    expect(line).not.toContain("SECRETVALUE");
    expect(line).not.toContain("EAAG123abc");
    expect(line).not.toContain("lookaside");
    expect(line).toContain("[url_redacted]");
  });
});