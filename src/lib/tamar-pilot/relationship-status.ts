/**
 * CANONICAL RELATIONSHIP STATUS (PURE).
 *
 * Relationship status is always relevant and is part of the baseline pilot
 * intake, presented as an interactive menu built from the existing CRM
 * intake definitions. The legacy "arriving alone or with someone" question is
 * removed from the baseline and must never be re-introduced.
 */
export const RELATIONSHIP_STATUS_FIELD_KEY = "relationship_status";

export const RELATIONSHIP_STATUS_VALUES = [
  "single",
  "in_relationship",
  "married",
  "separated",
  "divorced",
  "widowed",
] as const;

export type RelationshipStatus = (typeof RELATIONSHIP_STATUS_VALUES)[number];

export const RELATIONSHIP_STATUS_LABELS_HE: Record<RelationshipStatus, string> = {
  single: "רווק/ה",
  in_relationship: "בזוגיות",
  married: "נשוי/אה",
  separated: "פרוד/ה",
  divorced: "גרוש/ה",
  widowed: "אלמן/ה",
};

/** Intake keys that were removed from the baseline pilot journey. */
export const REMOVED_BASELINE_INTAKE_KEYS = [
  "arriving_alone",
  "coming_alone",
  "arriving_with",
  "attending_alone",
  "alone_or_with",
] as const;

export function isRemovedBaselineIntakeKey(key: string | null | undefined): boolean {
  const k = String(key ?? "").trim().toLowerCase();
  return (REMOVED_BASELINE_INTAKE_KEYS as readonly string[]).includes(k);
}

const ALIASES: Array<[RegExp, RelationshipStatus]> = [
  [/רווק|single|פנוי/i, "single"],
  [/בזוגיות|בקשר|in[_\s-]?relationship|partner/i, "in_relationship"],
  [/נשוי|נשואה|married/i, "married"],
  [/פרוד|separated/i, "separated"],
  [/גרוש|divorc/i, "divorced"],
  [/אלמן|אלמנה|widow/i, "widowed"],
];

/** Normalize free text / menu payloads to a canonical value (null when unknown). */
export function normalizeRelationshipStatus(raw: string | null | undefined): RelationshipStatus | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const direct = v.toLowerCase().replace(/[\s-]+/g, "_");
  if ((RELATIONSHIP_STATUS_VALUES as readonly string[]).includes(direct)) return direct as RelationshipStatus;
  for (const [re, value] of ALIASES) if (re.test(v)) return value;
  return null;
}

export type RelationshipStatusOption = { value: RelationshipStatus; label: string };

export function relationshipStatusOptions(): RelationshipStatusOption[] {
  return RELATIONSHIP_STATUS_VALUES.map((value) => ({
    value,
    label: RELATIONSHIP_STATUS_LABELS_HE[value],
  }));
}

/** The canonical CRM intake definition row for the menu question. */
export function relationshipStatusDefinition(orderIndex = 40) {
  return {
    field_key: RELATIONSHIP_STATUS_FIELD_KEY,
    label: "מצב משפחתי",
    question_text: "מה המצב המשפחתי שלך? (זה עוזר לי להתאים לך אירועים וטיולים)",
    presentation: "menu",
    options: relationshipStatusOptions(),
    required: true,
    skippable: false,
    enabled: true,
    order_index: orderIndex,
    purpose_text: "התאמת אירועים, טיולים והרכב קבוצה",
  };
}
