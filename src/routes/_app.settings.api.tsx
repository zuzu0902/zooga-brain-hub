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
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [pageId, setPageId] = useState("");
  const [defaultSource, setDefaultSource] = useState("Tamar Bot");
  const [tamarUrl, setTamarUrl] = useState("");
  const [tamarToken, setTamarToken] = useState("");
  const [hasTamarToken, setHasTamarToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingWa, setTestingWa] = useState(false);

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/webhook/tamar`;

  useEffect(() => {
    (async () => {
      try {
        const data = await getApiSettingsSafe();
        setPageId(data.facebook_page_id ?? "");
        setDefaultSource(data.default_source ?? "Tamar Bot");
        setTamarUrl((data.tamar_backend_url ?? "").trim());
        setHasToken(!!data.has_webhook_token);
        setHasTamarToken(!!data.has_tamar_backend_api_token);
      } catch (e: any) {
        toast.error("שגיאה בטעינת ההגדרות");
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
          tamar_backend_url: tamarUrl.trim() || null,
          webhook_token: token || "",
          tamar_backend_api_token: tamarToken.trim() || "",
        },
      });
      if (token) setHasToken(true);
      if (tamarToken.trim()) setHasTamarToken(true);
      setToken("");
      setTamarToken("");
      toast.success("ההגדרות נשמרו");
    } catch (e: any) {
      toast.error("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("הועתק");
  }

  async function testWebhook() {
    setTesting(true);
    try {
      const res = await fetch(webhookUrl, {
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
        toast.error(`שגיאה (${res.status}): ${json?.error || "כשל בקריאה"}`);
        return;
      }
      if (json?.matched) {
        toast.success(`נמצא איש קשר קיים והאינטראקציה נרשמה (${json.contact_id})`);
      } else if (json?.intake_id) {
        // Confirm intake item exists
        const { data } = await supabase
          .from("intake_inbox")
          .select("id, parsed_name, status")
          .eq("id", json.intake_id)
          .maybeSingle();
        if (data) {
          toast.success(`נוצר פריט בתיבת קליטה: ${data.parsed_name} (${data.status})`);
        } else {
          toast.warning("הוובהוק החזיר הצלחה אך לא נמצא פריט בתיבת הקליטה");
        }
      } else {
        toast.success("הוובהוק התקבל");
      }
    } catch (e: any) {
      toast.error("שגיאת רשת: " + (e?.message || String(e)));
    } finally {
      setTesting(false);
    }
  }

  async function testTamarWhatsApp() {
    setTestingWa(true);
    try {
      const phone = "+972547702620";
      const res = await fetch(webhookUrl, {
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
        toast.error(`שגיאה (${res.status}): ${json?.error || "כשל"}`);
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
          `איש קשר עודכן (${json.contact_id.slice(0, 8)}). אינטראקציה: ${inter?.id ? "נשמרה" : "לא נמצאה"}`,
        );
      } else if (json?.intake_id) {
        const { data } = await supabase
          .from("intake_inbox")
          .select("id, parsed_phone, parsed_message, status")
          .eq("id", json.intake_id)
          .maybeSingle();
        if (data) {
          toast.success(
            `${json.updated ? "עודכן" : "נוצר"} פריט אינטייק: ${data.parsed_phone} — "${data.parsed_message}"`,
          );
        } else {
          toast.warning("הצלחה אך לא נמצא פריט אינטייק");
        }
      } else {
        toast.success("הוובהוק התקבל");
      }
    } catch (e: any) {
      toast.error("שגיאת רשת: " + (e?.message || String(e)));
    } finally {
      setTestingWa(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">טוען...</div>;
  }

  return (
    <div className="p-8 max-w-3xl space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">הגדרות API</h1>
        <p className="text-sm text-muted-foreground mt-1">
          חיבור בוט תמר וערוצים נוספים למערכת
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Webhook של בוט תמר</h2>
        <div>
          <Label>כתובת ה־Webhook</Label>
          <div className="flex gap-2 mt-1">
            <Input value={webhookUrl} readOnly dir="ltr" />
            <Button variant="outline" size="icon" onClick={() => copy(webhookUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            הדבק כתובת זו בהגדרות בוט תמר. הבוט ישלח לכאן POST עם נתוני הליד.
          </p>
        </div>

        <div>
          <Label>Webhook Token (אבטחה)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              dir="ltr"
              placeholder={hasToken ? "••••••• (מוגדר) — הזן ערך חדש כדי לעדכן" : "ייווצר אוטומטית"}
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
            הבוט חייב לשלוח ערך זה בכותרת <code dir="ltr">x-api-token</code> או בפרמטר <code dir="ltr">?token=</code>. הערך הנוכחי אינו מוצג — הזן ערך חדש כדי להחליף.
          </p>
        </div>

        <div>
          <Label>מזהה דף פייסבוק (אופציונלי)</Label>
          <Input value={pageId} onChange={(e) => setPageId(e.target.value)} dir="ltr" />
        </div>

        <div>
          <Label>מקור ברירת מחדל</Label>
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
              {testing ? "בודק..." : "בדיקת Webhook"}
            </Button>
            <Button variant="outline" onClick={testTamarWhatsApp} disabled={testingWa}>
              {testingWa ? "בודק..." : "בדיקת תמר וואטסאפ"}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "שומר..." : "שמור הגדרות"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">דוגמת Payload</h2>
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

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Tamar Backend (Railway)</h2>
        <p className="text-xs text-muted-foreground">
          כאן מוגדרת כתובת ה-backend של בוט תמר ב-Railway. Lovable שולחת לכאן את הלידים שנבחרו לקמפיין אינטייק. שליחת WhatsApp עצמה מתבצעת בצד תמר, לא ב-Lovable.
        </p>
        <div>
          <Label>Tamar Backend URL</Label>
          <Input
            value={tamarUrl}
            onChange={(e) => setTamarUrl(e.target.value)}
            dir="ltr"
            placeholder="https://tamar-bot.up.railway.app"
          />
          <p className="text-xs text-muted-foreground mt-1">
            הקריאה תבוצע ל-<code dir="ltr">{tamarUrl ? tamarUrl.replace(/\/$/, "") + "/campaigns/intake" : "<URL>/campaigns/intake"}</code>
          </p>
        </div>
        <div>
          <Label>Tamar API Token</Label>
          <Input
            value={tamarToken}
            onChange={(e) => setTamarToken(e.target.value)}
            dir="ltr"
            placeholder={hasTamarToken ? "••••••• (מוגדר) — הזן ערך חדש כדי לעדכן" : "bearer token"}
            type="password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            יישלח כ-<code dir="ltr">Authorization: Bearer ...</code>. הערך הנוכחי אינו מוצג — הזן ערך חדש כדי להחליף.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור הגדרות"}</Button>
        </div>
      </Card>
    </div>
  );
}