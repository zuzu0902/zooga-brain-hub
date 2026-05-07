export const STATUS_LABELS: Record<string, string> = {
  new_lead: "ליד חדש",
  active_member: "חבר פעיל",
  interested: "מתעניין",
  customer: "לקוח",
  VIP: "VIP",
  inactive: "לא פעיל",
};

export const SOURCE_LABELS: Record<string, string> = {
  Facebook: "פייסבוק",
  WhatsApp: "וואטסאפ",
  "Zooga Website": "אתר זוגה",
  Event: "אירוע",
  "Tamar Bot": "בוט תמר",
  Manual: "ידני",
};

export const INTEREST_LABELS: Record<string, string> = {
  trips: "טיולים",
  parties: "מסיבות",
  lectures: "הרצאות",
  dating: "היכרויות",
  workshops: "סדנאות",
  travel: "נסיעות",
  premium_membership: "מנוי פרימיום",
};

export const LIFESTYLE_LABELS: Record<string, string> = {
  travel_abroad: "נסיעות לחו״ל",
  restaurants: "מסעדות",
  culture: "תרבות",
  nightlife: "חיי לילה",
  workshops: "סדנאות",
  luxury_hotels: "מלונות יוקרה",
};

export const CATEGORY_LABELS: Record<string, string> = {
  event: "אירוע",
  trip: "טיול",
  party: "מסיבה",
  lecture: "הרצאה",
  workshop: "סדנה",
  digital_product: "מוצר דיגיטלי",
  membership: "מנוי",
};

export const SPENDING_LABELS: Record<string, string> = {
  budget: "חסכוני",
  standard: "סטנדרטי",
  premium: "פרימיום",
  luxury: "יוקרה",
};

export const INCOME_LABELS: Record<string, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
  prefer_not_to_say: "מעדיף לא לציין",
};

export const INTERACTION_TYPE_LABELS: Record<string, string> = {
  facebook_message: "הודעה בפייסבוק",
  whatsapp_message: "הודעה בוואטסאפ",
  link_click: "לחיצה על קישור",
  event_interest: "התעניינות באירוע",
  form_submit: "שליחת טופס",
  purchase_interest: "התעניינות ברכישה",
  admin_note: "הערת מנהל",
};

export const CHANNEL_LABELS: Record<string, string> = {
  Facebook: "פייסבוק",
  WhatsApp: "וואטסאפ",
  SMS: "SMS",
  Email: "אימייל",
};

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה",
  sent: "נשלח",
  failed: "נכשל",
  replied: "ענה",
};

export const ALL_INTERESTS = Object.keys(INTEREST_LABELS);
export const ALL_LIFESTYLE = Object.keys(LIFESTYLE_LABELS);

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(d));
}