import type { Database } from "@/integrations/supabase/types";

export type IntakeFlowType = Database["public"]["Enums"]["intake_flow_type"];

export const INTAKE_FLOW_LABELS: Record<IntakeFlowType, string> = {
  trip: "טיול",
  event: "אירוע",
  party: "מסיבה",
  dating: "היכרויות",
  workshop: "סדנה",
  vip: "VIP",
  community: "קהילה",
  sales_inquiry: "פנייה מכירתית",
  generic: "כללי",
};

export const INTAKE_FLOWS: Record<
  IntakeFlowType,
  { questions: string[]; system_addendum: string }
> = {
  trip: {
    questions: [
      "לאיזה יעד את/ה הכי נמשך/ת?",
      "מה התקציב שנוח לך לטיול?",
      "באילו תאריכים תרצה/י לצאת?",
      "עם מי תרצה/י לטייל — לבד, חברים, זוגי?",
      "סגנון טיול מועדף — חוויות, רגיעה, אקסטרים?",
    ],
    system_addendum:
      "המשתמש/ת הגיע/ה מקמפיין טיול. התמקדי בהתאמת היעד, סגנון הטיול, תקציב, זמינות והרכב הנוסעים. אל תשאלי שאלות כלליות לפני שהבנת את ההקשר של הטיול.",
  },
  event: {
    questions: [
      "איזה סוג אירוע מעניין אותך?",
      "באיזה אזור נוח לך להגיע?",
      "איזה תאריך מתאים?",
      "כמה אנשים מצטרפים?",
    ],
    system_addendum:
      "המשתמש/ת הגיע/ה מקמפיין אירוע. בררי סוג, אזור, תאריך וכמות אנשים — אבל קודם הזכירי את האירוע הספציפי.",
  },
  party: {
    questions: [
      "איזה סגנון מסיבה את/ה אוהב/ת?",
      "באיזה אזור?",
      "מגיע/ה לבד או עם חברים?",
    ],
    system_addendum:
      "המשתמש/ת מגיע/ה מקמפיין מסיבה. שמרי על אנרגיה גבוהה וטון קליל.",
  },
  dating: {
    questions: [
      "מה המצב המשפחתי שלך כיום?",
      "מה את/ה מחפש/ת — קשר רציני, חברה, היכרות קלילה?",
      "טווח גילים שמעניין אותך?",
    ],
    system_addendum:
      "המשתמש/ת מגיע/ה מקמפיין היכרויות. גישה רגישה, ללא שיפוטיות. אל תבטיחי התאמות — תמר רק מבררת.",
  },
  workshop: {
    questions: [
      "באיזה נושא הסדנה תופסת אותך?",
      "יש לך ניסיון קודם בתחום?",
      "מה הזמינות שלך?",
    ],
    system_addendum:
      "המשתמש/ת מגיע/ה מקמפיין סדנה. בררי רמת ניסיון ומוטיבציה.",
  },
  vip: {
    questions: [
      "איזה סוג חוויה VIP מעניינת אותך?",
      "מה רמת הפרטיות שחשובה לך?",
      "האם יש העדפות מיוחדות?",
    ],
    system_addendum:
      "המשתמש/ת מגיע/ה ממסלול VIP. טון יוקרתי, דיסקרטי ומקצועי. אל תדברי על מחיר אלא אם נשאלת.",
  },
  community: {
    questions: [
      "מה תחומי העניין המרכזיים שלך?",
      "באיזה אזור את/ה?",
      "כמה פעילות תרצה/י — שבועי, חודשי?",
    ],
    system_addendum:
      "המשתמש/ת מתעניין/ת בקהילה. הדגישי שייכות, חברים חדשים והתאמה אישית.",
  },
  sales_inquiry: {
    questions: [
      "מה ראית/שמעת שגרם לך לפנות?",
      "יש משהו שמעכב אותך כרגע?",
      "באיזה טווח זמן תרצה/י להתקדם?",
    ],
    system_addendum:
      "פנייה מכירתית. זהי התנגדויות, צרכים וטריגרים להחלטה. אל תהיי לוחצנית.",
  },
  generic: {
    questions: [
      "מה שמך?",
      "ממה הגעת אלינו?",
      "מה הכי מעניין אותך מהפעילות של זוגה?",
    ],
    system_addendum:
      "אינטייק כללי. בררי את ההקשר שגרם לפנייה לפני שתמשיכי.",
  },
};

export function buildSuggestedOpening(args: {
  contactName?: string | null;
  campaignName?: string | null;
  flow: IntakeFlowType;
  emotionalAngle?: string | null;
}): string {
  const greet = args.contactName ? `היי ${args.contactName} 🙂` : "היי 🙂";
  if (!args.campaignName) {
    return `${greet} כאן תמר מזוגה. שמחה שפנית! איך אפשר לעזור?`;
  }
  const flowEmoji: Record<IntakeFlowType, string> = {
    trip: "✈️",
    event: "🎉",
    party: "🎶",
    dating: "💛",
    workshop: "✨",
    vip: "👑",
    community: "🤝",
    sales_inquiry: "💬",
    generic: "🙂",
  };
  return `${greet} כאן תמר מזוגה.\nראיתי שפנית בנוגע ל${args.campaignName} ${flowEmoji[args.flow]}\nרוצה שאעזור לך להבין אם זה יכול להתאים לך?`;
}