
# הצגת שדות מפתח ב-Identity Header

מטרה: שכל המידע המהותי על הלקוח יהיה גלוי מיד בכניסה לכרטיס, בלי שצריך להיכנס ל-Edit Profile.

## מה נוסיף לכותרת (`IdentityHeader`)

נוסיף **רצועת "Quick Facts"** מתחת לפרטי הקשר ומעל ה-ScorePills, עם 3 שורות תמציתיות:

### שורה 1 — דמוגרפיה
- מגדר · גיל / טווח גיל · סטטוס משפחתי · אזור · עיר · יום הולדת (אם קיים)

### שורה 2 — תחומי עניין ואופי (chips)
- `interests` (תחומי עניין) — chips צבעוניים
- `hobbies` (תחביבים)
- `personality_tags` (אופי)
- `lifestyle_tags` (סגנון חיים)

עד 8 chips ראשונים גלויים; אם יש יותר — "+N" שמרחיב במעבר עכבר.

### שורה 3 — פרופיל מכירות ותקשורת (badges קטנים)
- סגנון תקשורת (`communication_style`)
- פרופיל רגשי (`emotional_profile`)
- סגנון חברתי (`preferred_social_style`)
- רגישות מחיר (`budget_sensitivity` / `price_sensitivity`)
- כוונת רכישה (`purchase_intent`)
- שפה מועדפת (`preferred_language_style`)

כל שדה ריק פשוט לא מוצג (אין placeholders ריקים).

## עיצוב

- כל קבוצה עטופה ב-section עם תווית קטנה ב-`text-muted-foreground` (`דמוגרפיה`, `תחומי עניין`, `פרופיל`)
- שימוש ב-`Badge` קיים עם variants סמנטיים מ-design system
- רספונסיבי: ב-mobile יורד לעמודה אחת, ב-desktop בשורות אופקיות עם `flex-wrap`
- פס מפריד עדין (`border-border/60`) בין הכותרת ל-Quick Facts ובין Quick Facts ל-Score Row

## מה לא משתנה

- כל שאר הסקציות (Memory / Actions / Timeline / Edit Profile) נשארות זהות
- Edit Profile ממשיך לאפשר עריכה מלאה של כל שדה
- אין שינויים ב-DB, ב-extractor, או בלוגיקה — רק שכבת תצוגה ב-`IdentityHeader`

## קבצים שיושפעו

- `src/routes/_app.contacts.$id.tsx` בלבד — עריכת הקומפוננטה `IdentityHeader` (שורות 224-326)
