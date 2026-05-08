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

export const SALES_TEMP_LABELS: Record<string, string> = {
  cold: "קר",
  warm: "חמים",
  hot: "חם",
};

export const SALES_TEMP_TONE: Record<string, string> = {
  cold: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  warm: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  hot: "bg-red-500/10 text-red-700 border-red-500/30",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  open: "פתוחה",
  in_progress: "בטיפול",
  done: "הושלמה",
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחוף",
};

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(d));
}

export function formatRelative(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "כעת";
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דק׳`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שעות`;
  if (diff < 604800) return `לפני ${Math.floor(diff / 86400)} ימים`;
  return formatDate(d);
}