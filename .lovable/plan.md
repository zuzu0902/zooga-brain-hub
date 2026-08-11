# למה יש לופ במספר ...2620

## מה קורה בפועל

לאלכס (‎+972547702620) נשלחה שלוש פעמים בדקה אותה הודעה בדיוק:
"קיבלתי את ההודעה שלך… לא הצלחתי לנסח תשובה מדויקת… מה הכי חשוב לך שנדבר עליו עכשיו".
זו לא תשובה של המנוע — זו הודעת ה-Recovery Fallback. כל תור נכשל, והפולבק נשלח שוב ושוב.

## הסיבה האמיתית (מאומתת בלוגים)

בכל תור נרשם ב-webhook_logs רשומת `turn_failed` עם השגיאה:

```text
db(...).from(...).upsert(...).catch is not a function
```

השאילתות של supabase-js אינן Promise אמיתי — יש להן `then` אבל אין `catch`.
לכן כל קריאה בסגנון `db().from(X).upsert({...}).catch(() => null)` זורקת TypeError.
השגיאה קורית ב-Inbound Context Gate (‎src/lib/inbound-gate/gate.server.ts, כתיבת
`inbound_gate_decisions`) — כלומר לפני שהמנוע בכלל מספיק לענות. התוצאה: כל הודעה נכנסת
נופלת לפולבק.

הכשל השני, שהופך את זה ללופ ולא רק לתשובה גנרית: הטבלה `conversation_turns` ריקה לגמרי
(0 שורות בכל המערכת). הכתיבה אליה בשומר הלופים נעשית באותו דפוס `.upsert(...).catch(...)`
ונכשלת בשקט. בלי היסטוריית תורים, ה-Conversation Guard לא רואה שהשאלה כבר נשלחה, ולכן
מאשר "send" לאותו טקסט בכל פעם — אין שום מנגנון שעוצר את החזרה.

זה לא ייחודי ל-2620: אותו `turn_failed` מופיע גם למספרים אחרים (למשל ‎...0735) באותן דקות.

## מה לתקן

1. **להחליף כל `.catch()` על שאילתת Supabase בטיפול שגיאות תקין** — לעטוף ב-`await` בתוך
   try/catch או להשתמש ב-`Promise.resolve(query)`/`.then(r=>r, ()=>null)`.
   קבצים מושפעים: `src/lib/inbound-gate/gate.server.ts`, `src/lib/conversation-guard/guard.server.ts`,
   `src/lib/conversation-guard/fallback.server.ts`, `src/lib/onboarding/onboarding.server.ts`,
   `src/routes/api/public/webhook/tamar.ts`.
2. **להקשיח את ה-Gate**: כשל בכתיבת טלמטריה (inbound_gate_decisions) לעולם לא יפיל תור.
3. **לוודא ש-`conversation_turns` נכתבת בפועל** — ולוודא שכשל כתיבה בשומר הלופים מדווח
   (‎`logged=false` היום נבלע לגמרי).
4. **מנגנון עצירה לפולבק**: אותו טקסט פולבק לא יישלח פעמיים ברצף לאותו איש קשר בחלון קצר,
   גם כשאין היסטוריית תורים.
5. **כפילות איש קשר**: קיימות שתי שורות לאותו מספר — `+972547702620` ו-`972547702620`.
   לאחד/לנרמל כדי שהיסטוריה ומצב לא יתפצלו.

## אימות

בדיקת אינטגרציה דרך ה-handler האמיתי: הודעה נכנסת עוברת gate + guard, נרשמת שורת
`conversation_turns`, ואין `turn_failed`; שתי הודעות רצופות שנכשלות אינן מייצרות שתי
הודעות פולבק זהות. ואז מעקב ב-webhook_logs שאין יותר `catch is not a function`.
