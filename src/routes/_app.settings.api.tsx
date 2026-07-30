import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { SOURCE_LABELS } from "@/lib/i18n";
import { Copy, RefreshCw } from "lucide-react";
import { getApiSettingsSafe, updateApiSettings } from "@/lib/api-settings.functions";
import { useT, useLanguage } from "@/lib/language-context";

export const Route = createFileRoute("/_app/settings/api")({
  head: () => ({ meta: [{ title: "הגדרות API — Zooga CRM" }] }),
  component: ApiSettingsPage,
});

function genToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ApiSettingsPage() {
  const t = useT();
  const { dir } = useLanguage();
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [pageId, setPageId] = useState("");
  const [defaultSource, setDefaultSource] = useState("Tamar Bot");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingWa, setTestingWa] = useState(false);

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/webhook/tamar`;
  const engineUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/runtime/tamar-turn`;

  useEffect(() => {
    (async () => {
      try {
        const data = await getApiSettingsSafe();
        setPageId(data.facebook_page_id ?? "");
        setDefaultSource(data.default_source ?? "Tamar Bot");
        setHasToken(!!data.has_webhook_token);
      } catch (e: any) {
        toast.error(t("שגיאה בטעינת ההגדרות"));
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await updateApiSettings({
        data: {
          facebook_page_id: pageId || null,
          default_source: defaultSource,
          webhook_token: token || "",
        },
      });
      if (token) setHasToken(true);
      setToken("");
      toast.success(t("ההגדרות נשמרו"));
    } catch (e: any) {
      toast.error(t("שגיאה בשמירה"));
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success(t("הועתק"));
  }

  async function testWebhook() {
    setTesting(true);
    try {
      const res = await fetch(engineUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-api-token": token } : {}),
        },
        body: JSON.stringify({
          name: "בדיקת מערכת",
          phone: "+972501111111",
          facebook_id: "TEST_FACEBOOK_001",
          message: "זוהי בדיקת חיבור",
          source: "Tamar Bot",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`${t("שגיאה")} (${res.status}): ${json?.error || t("כשל בקריאה")}`);
        return;
      }
      if (json?.matched) {
        toast.success(`${t("נמצא איש קשר קיים והאינטראקציה נרשמה")} (${json.contact_id})`);
      } else if (json?.intake_id) {
        // Confirm intake item exists
        const { data } = await supabase
          .from("intake_inbox")
          .select("id, parsed_name, status")
          .eq("id", json.intake_id)
          .maybeSingle();
        if (data) {
          toast.success(`${t("נוצר פריט בתיבת קליטה")}: ${data.parsed_name} (${data.status})`);
        } else {
          toast.warning(t("הוובהוק החזיר הצלחה אך לא נמצא פריט בתיבת הקליטה"));
        }
      } else {
        toast.success(t("הוובהוק התקבל"));
      }
    } catch (e: any) {
      toast.error(t("שגיאת רשת") + ": " + (e?.message || String(e)));
    } finally {
      setTesting(false);
    }
  }

  async function testTamarWhatsApp() {
    setTestingWa(true);
    try {
      const phone = "+972547702620";
      const res = await fetch(engineUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-api-token": token } : {}),
        },
        body: JSON.stringify({
          phone,
          whatsapp_number: phone,
          name: "Alex Z",
          message: "היי",
          source: "Tamar WhatsApp",
          intake_status: "started",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`${t("שגיאה")} (${res.status}): ${json?.error || t("כשל")}`);
        return;
      }
      if (json?.matched) {
        // Verify interaction was logged
        const { data: inter } = await supabase
          .from("interactions")
          .select("id, content, type")
          .eq("contact_id", json.contact_id)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();
        toast.success(
          `${t("איש קשר עודכן")} (${json.contact_id.slice(0, 8)}). ${t("אינטראקציה")}: ${inter?.id ? t("נשמרה") : t("לא נמצאה")}`,
        );
      } else if (json?.intake_id) {
        const { data } = await supabase
          .from("intake_inbox")
          .select("id, parsed_phone, parsed_message, status")
          .eq("id", json.intake_id)
          .maybeSingle();
        if (data) {
          toast.success(
            `${json.updated ? t("עודכן") : t("נוצר")} ${t("פריט אינטייק")}: ${data.parsed_phone} — "${data.parsed_message}"`,
          );
        } else {
          toast.warning(t("הצלחה אך לא נמצא פריט אינטייק"));
        }
      } else {
        toast.success(t("הוובהוק התקבל"));
      }
    } catch (e: any) {
      toast.error(t("שגיאת רשת") + ": " + (e?.message || String(e)));
    } finally {
      setTestingWa(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">{t("טוען...")}</div>;
  }

  return (
    <div className="p-8 max-w-3xl space-y-6" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold">{t("הגדרות API")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("חיבור בוט תמר וערוצים נוספים למערכת")}
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">{t("Webhook של בוט תמר")}</h2>
        <div>
          <Label>{t("כתובת ה־Webhook")}</Label>
          <div className="flex gap-2 mt-1">
            <Input value={webhookUrl} readOnly dir="ltr" />
            <Button variant="outline" size="icon" onClick={() => copy(webhookUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("הדבק כתובת זו בהגדרות בוט תמר. הבוט ישלח לכאן POST עם נתוני הליד.")}
          </p>
        </div>

        <div>
          <Label>{t("Webhook Token (אבטחה)")}</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              dir="ltr"
              placeholder={hasToken ? t("••••••• (מוגדר) — הזן ערך חדש כדי לעדכן") : t("ייווצר אוטומטית")}
              type="password"
            />
            <Button variant="outline" size="icon" onClick={() => setToken(genToken())}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => copy(token)} disabled={!token}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("הבוט חייב לשלוח ערך זה בכותרת")} <code dir="ltr">x-api-token</code> {t("או בפרמטר")} <code dir="ltr">?token=</code>. {t("הערך הנוכחי אינו מוצג — הזן ערך חדש כדי להחליף.")}
          </p>
        </div>

        <div>
          <Label>{t("מזהה דף פייסבוק (אופציונלי)")}</Label>
          <Input value={pageId} onChange={(e) => setPageId(e.target.value)} dir="ltr" />
        </div>

        <div>
          <Label>{t("מקור ברירת מחדל")}</Label>
          <Select value={defaultSource} onValueChange={setDefaultSource}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end">
          <div className="flex gap-2">
            <Button variant="outline" onClick={testWebhook} disabled={testing}>
              {testing ? t("בודק...") : t("בדיקת Webhook")}
            </Button>
            <Button variant="outline" onClick={testTamarWhatsApp} disabled={testingWa}>
              {testingWa ? t("בודק...") : t("בדיקת תמר וואטסאפ")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t("שומר...") : t("שמור הגדרות")}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">{t("דוגמת Payload")}</h2>
        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto" dir="ltr">
{`POST ${webhookUrl}
Headers: x-api-token: <TOKEN>
Body:
{
  "name": "ישראל ישראלי",
  "phone": "+972501234567",
  "facebook_id": "1234567890",
  "email": "israel@example.com",
  "message": "מעוניין לשמוע על הקהילה",
  "source": "Tamar Bot"
}`}
        </pre>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">{t("ערוץ WhatsApp (Meta ישיר)")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Zooga מקבלת הודעות ישירות מ-Meta ושולחת תשובות ישירות דרך Meta Graph API. אין backend חיצוני. ה-secrets נשמרים בסביבת השרת בלבד ולא בטבלאות המערכת.")}
        </p>
        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto" dir="ltr">
{`Callback URL:  ${webhookUrl}
Verify token:  META_VERIFY_TOKEN (server secret)
Signature:     X-Hub-Signature-256 via META_APP_SECRET
Send:          WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID`}
        </pre>
      </Card>
    </div>
  );
}