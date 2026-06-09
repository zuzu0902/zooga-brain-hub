## הבעיה
ב-Safari, אחרי התחברות מוצלחת עם Google (auth log מאשר login 200), המשתמש מועבר חזרה ל-`/login` במקום להישאר ב-`/`. ב-Chrome זה עובד.

## שורש הבעיה
ב-`src/routes/login.tsx`, גם ב-`handleGoogle` וגם ב-`handleLogin`, אחרי הצלחת ההתחברות מתבצע `window.location.href = "/"` — רענון דף מלא. הרענון מאלץ את `AuthProvider` ב-`src/lib/auth-context.tsx` לקרוא את ה-session מחדש מ-localStorage דרך `getSession()`. ב-Safari (בגלל ITP וטיימינג של כתיבה ל-localStorage אחרי `setSession` מ-OAuth broker שמחזיר tokens ב-postMessage/id_token), הכתיבה לא תמיד מסתיימת לפני הניווט — אז בטעינה מחדש אין session, `_app.tsx` רואה `!user`, ומפנה חזרה ל-/login. נוצר רושם של "לופ".

זו אותה משפחת באג שתוקנה בעבר; הרגרסיה נכנסה כשהאינטגרציה של lovable broker החליפה את הפלואו הישיר של supabase.

## השינויים

### 1. `src/routes/login.tsx`
- ב-`handleGoogle`: להחליף `window.location.href = "/"` ב:
  - `navigate({ to: "/" })` (מ-`useNavigate` של TanStack) — שמנצל את ה-session in-memory שכבר נשמר ע"י `lovable.auth.signInWithOAuth` → `setSession`, בלי תלות ב-rehydrate מ-localStorage.
  - לפני הניווט: `await supabase.auth.getSession()` כ-sanity check; אם אין session, להציג toast שגיאה.
- ב-`handleLogin` (email/password): אותו דבר — `navigate({ to: "/" })` במקום `window.location.href`.
- להוסיף `import { useNavigate } from "@tanstack/react-router"`.

### 2. `src/lib/auth-context.tsx`
- להסיר את ה-`setTimeout(..., 0)` סביב קריאת `user_roles` בתוך `onAuthStateChange` — הוא מעכב את עדכון ה-user state מיותר. במקום, להעביר את שאילתת ה-role לקריאה ישירה (היא כבר לא חוסמת כי `setUser` קורה לפניה).
- לוודא שב-`SIGNED_IN` ה-`user` מתעדכן מיד (כבר כך — אבל הוידוא חשוב).

### 3. אין שינוי ב-`_app.tsx`
ה-logic של "redirect ל-/login אם !user אחרי loading" נכון; הבעיה היא רק שה-user לא היה זמין בזמן.

## אימות אחרי התיקון
- בדיקה ב-Safari: לחיצה על "המשך עם Google" → השלמת OAuth → להגיע ל-`/` ולהישאר שם.
- בדיקה ב-Chrome: לוודא אי-רגרסיה.
- בדיקה של email/password login באותה צורה.

## מחוץ ל-scope
- שינוי ה-OAuth broker עצמו (auto-generated, לא נוגעים).
- שינוי `_app.tsx` או ה-routing.
