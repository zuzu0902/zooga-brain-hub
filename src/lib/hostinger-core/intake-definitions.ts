/** Browser-safe contracts for Core intake definitions and handoff resolution. No I/O. */

export class CoreShapeError extends Error {
  constructor(public reason: string) { super(`core_shape_malformed:${reason}`); }
}

export type IntakeOption = { id: string; label: string; value: string };
export type IntakeDefinition = {
  field_key: string; label: string; question_text: string; purpose_text: string | null;
  presentation: "text" | "menu" | "multi"; options: IntakeOption[];
  required: boolean; skippable: boolean; order_index: number; enabled: boolean;
  stage: "baseline" | "progressive"; depends_on: Record<string, unknown>;
};
export type IntakeDefinitionPatch = Partial<Pick<IntakeDefinition, "label" | "question_text" | "purpose_text" | "required" | "skippable" | "order_index" | "enabled">>;

const o = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});

export function parseIntakeDefinition(raw: unknown): IntakeDefinition {
  const r = o(raw);
  if (typeof r.field_key !== "string" || !r.field_key) throw new CoreShapeError("field_key");
  if (!["text", "menu", "multi"].includes(r.presentation)) throw new CoreShapeError("presentation");
  if (r.stage !== "baseline" && r.stage !== "progressive") throw new CoreShapeError("stage");
  for (const k of ["required", "skippable", "enabled"]) if (typeof r[k] !== "boolean") throw new CoreShapeError(k);
  if (!Number.isFinite(r.order_index)) throw new CoreShapeError("order_index");
  return {
    field_key: r.field_key, label: String(r.label ?? ""), question_text: String(r.question_text ?? ""),
    purpose_text: typeof r.purpose_text === "string" ? r.purpose_text : null,
    presentation: r.presentation, stage: r.stage, required: r.required, skippable: r.skippable, enabled: r.enabled,
    order_index: Number(r.order_index), depends_on: o(r.depends_on),
    options: (Array.isArray(r.options) ? r.options : []).map((x: any) => ({ id: String(x?.id ?? ""), label: String(x?.label ?? ""), value: String(x?.value ?? "") })),
  };
}

export function parseIntakeDefinitions(body: unknown): IntakeDefinition[] {
  const b = o(body);
  if (b.ok !== true || !Array.isArray(b.definitions)) throw new CoreShapeError("definitions");
  return b.definitions.map(parseIntakeDefinition).sort((a: IntakeDefinition, z: IntakeDefinition) => a.order_index - z.order_index);
}

const PATCH_KEYS = ["label", "question_text", "purpose_text", "required", "skippable", "order_index", "enabled"] as const;
/** Only the editable keys Core accepts; options/stage/presentation are never sent. */
export function sanitizeIntakePatch(p: Record<string, unknown>): IntakeDefinitionPatch {
  const out: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) if (k in p) out[k] = p[k];
  if ("order_index" in out && !Number.isInteger(out.order_index)) throw new CoreShapeError("order_index");
  if ("question_text" in out && !String(out.question_text ?? "").trim()) throw new CoreShapeError("question_text");
  return out as IntakeDefinitionPatch;
}

export const INTAKE_ERROR_TEXT: Record<string, string> = {
  invalid_definition: "Core דחה את ההגדרה — בדקו את הערכים",
  ungrounded_perk_wording: "הנוסח מבטיח הטבה או מתנה שאינה מוגדרת — הסירו את ההבטחה",
};

// ---------- Handoff resolution ----------
export const RESOLVE_OUTCOMES = ["resolved", "sold", "scheduled_followup", "needs_more_info", "not_interested", "no_answer", "escalated"] as const;
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number];
export const RESOLVE_OUTCOME_LABELS: Record<ResolveOutcome, string> = {
  resolved: "טופל ונסגר", sold: "בוצעה מכירה/הרשמה", scheduled_followup: "נקבע מעקב", needs_more_info: "נדרש מידע נוסף",
  not_interested: "לא מעוניין", no_answer: "לא היה מענה", escalated: "הועבר להמשך טיפול",
};
export type HandoffResolveInput = { contacted: boolean; outcome: string; summary: string; contacted_at?: string | null };
export type HandoffResolveBody = { contacted: true; outcome: ResolveOutcome; summary: string; contacted_at?: string };

export function resolveBlockers(i: HandoffResolveInput): string[] {
  const b: string[] = [];
  if (i.contacted !== true) b.push("יש לאשר שבוצעה יצירת קשר עם הלקוח");
  if (!(RESOLVE_OUTCOMES as readonly string[]).includes(i.outcome)) b.push("יש לבחור תוצאה");
  const len = String(i.summary ?? "").trim().length;
  if (len < 10 || len > 2000) b.push("סיכום המנהל חייב להכיל 10–2000 תווים");
  if (i.contacted_at && Number.isNaN(Date.parse(i.contacted_at))) b.push("מועד יצירת הקשר אינו תקין");
  return b;
}

export function buildResolveBody(i: HandoffResolveInput): HandoffResolveBody {
  if (resolveBlockers(i).length) throw new CoreShapeError("manager_outcome_required");
  const body: HandoffResolveBody = { contacted: true, outcome: i.outcome as ResolveOutcome, summary: i.summary.trim() };
  if (i.contacted_at) body.contacted_at = new Date(i.contacted_at).toISOString();
  return body;
}

export const RESOLVABLE_STATES = ["open", "claimed", "pending", "under_human", "accepted", "in_progress"];
export const canResolveHandoff = (state: string | null) => !!state && RESOLVABLE_STATES.includes(state);

export function parseResolveResult(body: unknown): { id: string; released: boolean; duplicate: boolean } {
  const h = o(o(body).handoff);
  if (o(body).ok !== true || typeof h.id !== "string" || typeof h.released !== "boolean") throw new CoreShapeError("handoff");
  return { id: h.id, released: h.released, duplicate: h.duplicate === true };
}
