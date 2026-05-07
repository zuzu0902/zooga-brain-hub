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
  const [pageId, setPageId] = useState("");
  const [defaultSource, setDefaultSource] = useState("Tamar Bot");
  const [tamarUrl, setTamarUrl] = useState("");
  const [tamarToken, setTamarToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/webhook/tamar`;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("api_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setToken(data.webhook_token ?? "");
        setPageId(data.facebook_page_id ?? "");
        setDefaultSource(data.default_source ?? "Tamar Bot");
        setTamarUrl((data as any).tamar_backend_url ?? "");
        setTamarToken((data as any).tamar_backend_api_token ?? "");
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("api_settings")
      .upsert({
        id: 1,
        webhook_token: token || null,
        facebook_page_id: pageId || null,
        default_source: defaultSource as any,
        tamar_backend_url: tamarUrl || null,
        tamar_backend_api_token: tamarToken || null,
      });
    setSaving(false);
    if (error) toast.error("שגיאה: " + error.message);
    else toast.success("ההגדרות נשמרו");
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
              placeholder="ייווצר אוטומטית"
            />
            <Button variant="outline" size="icon" onClick={() => setToken(genToken())}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => copy(token)} disabled={!token}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            הבוט חייב לשלוח ערך זה בכותרת <code dir="ltr">x-api-token</code> או בפרמטר <code dir="ltr">?token=</code>.
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
            placeholder="bearer token"
            type="password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            יישלח כ-<code dir="ltr">Authorization: Bearer ...</code>. תמר תוכל לאמת את אותו token כשהיא קוראת בחזרה ל-<code dir="ltr">/api/public/webhook/tamar-status</code> לעדכוני סטטוס.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור הגדרות"}</Button>
        </div>
      </Card>
    </div>
  );
}