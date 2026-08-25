/**
 * ZOOGA OS — הפצה לקבוצות WhatsApp (Control Plane בלבד).
 * אין שליחה בפועל מהמערכת: הגשר החיצוני (WhatsApp Web Bridge) יבצע בעתיד.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createBroadcast,
  cancelBroadcast,
  deleteGroupFolder,
  listGroupFolders,
  saveGroupFolder,
  listBroadcasts,
  listWhatsappConnections,
  listWhatsappGroups,
} from "@/lib/whatsapp-broadcast.functions";
import { runBroadcastNow } from "@/lib/whatsapp-broadcast-runner.functions";
import {
  BROADCAST_STATUS_LABELS,
  broadcastErrorLabel,
  canOwnGroupBroadcast,
  validateBroadcastDraft,
  type WaConnection,
} from "@/lib/whatsapp-broadcast/core";
import {
  applyFoldersToSelection,
  DEFAULT_BROADCAST_INTERVAL_SECONDS,
  folderCounts,
  validateFolderName,
  type GroupFolder,
} from "@/lib/whatsapp-broadcast/folders";
import { getBridgeStatus, syncBridgeGroups } from "@/lib/whatsapp-bridge.functions";
import {
  BRIDGE_ERROR_LABELS,
  BRIDGE_STATE_LABELS,
  type BridgeStatus,
} from "@/lib/zooga-whatsapp-bridge/bridge-contract";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/i18n";


export const Route = createFileRoute("/_app/broadcasts")({
  component: BroadcastsPage,
  head: () => ({
    meta: [
      { title: "הפצה לקבוצות WhatsApp · Zooga OS" },
      { name: "description", content: "ניהול קבוצות WhatsApp, חיבור הודעות והפצה מתוזמנת דרך Alex Personal." },
      { property: "og:title", content: "הפצה לקבוצות WhatsApp · Zooga OS" },
      { property: "og:description", content: "מרכז בקרה להפצות קבוצתיות בזוגה." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function BroadcastsPage() {
  const qc = useQueryClient();
  const connFn = useServerFn(listWhatsappConnections);
  const groupsFn = useServerFn(listWhatsappGroups);
  const historyFn = useServerFn(listBroadcasts);

  const connections = useQuery({ queryKey: ["wa", "connections"], queryFn: () => connFn({}) });
  const groupsQ = useQuery({ queryKey: ["wa", "groups"], queryFn: () => groupsFn({}) });
  const historyQ = useQuery({ queryKey: ["wa", "broadcasts"], queryFn: () => historyFn({}) });

  const bridgeStatusFn = useServerFn(getBridgeStatus);
  const bridgeStatusQ = useQuery({
    queryKey: ["wa", "bridge", "status"],
    queryFn: () => bridgeStatusFn({}),
    refetchInterval: 30_000,
  });
  const bridgeStatus = bridgeStatusQ.data as BridgeStatus | undefined;
  const bridge = ((connections.data ?? []) as WaConnection[]).find(canOwnGroupBroadcast) ?? null;

  const groups = useMemo(
    () => ((groupsQ.data ?? []) as any[]).filter((g) => bridge && g.connection_id === bridge.id),
    [groupsQ.data, bridge],
  );

  const foldersFn = useServerFn(listGroupFolders);
  const foldersQ = useQuery({ queryKey: ["wa", "folders"], queryFn: () => foldersFn({}) });
  const folders = useMemo(
    () => ((foldersQ.data ?? []) as GroupFolder[]).filter((f) => bridge && f.connection_id === bridge.id),
    [foldersQ.data, bridge],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [activeFolders, setActiveFolders] = useState<string[]>([]);
  const [folderName, setFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<GroupFolder | null>(null);
  const [category, setCategory] = useState<string>("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(String(DEFAULT_BROADCAST_INTERVAL_SECONDS));
  const [groupQuery, setGroupQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(groups.map((g) => g.category).filter(Boolean))) as string[],
    [groups],
  );

  const visibleGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      [g.current_name, g.category].filter(Boolean).some((v: string) => String(v).toLowerCase().includes(q)),
    );
  }, [groups, groupQuery]);

  const allBroadcasts = useMemo(() => ((historyQ.data ?? []) as any[]), [historyQ.data]);
  const queued = useMemo(
    () =>
      allBroadcasts
        .filter((b) => b.status === "draft" || b.status === "queued" || b.status === "running")
        .sort((a, b) => {
          const av = a.scheduled_for ? new Date(a.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
          const bv = b.scheduled_for ? new Date(b.scheduled_for).getTime() : Number.MAX_SAFE_INTEGER;
          return av - bv || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }),
    [allBroadcasts],
  );


  const syncGroups = useMutation({
    mutationFn: useServerFn(syncBridgeGroups),
    onSuccess: (r: any) => {
      if (r?.ok === false) {
        toast.error(BRIDGE_ERROR_LABELS[r.code] ?? "רענון הקבוצות נכשל");
        return;
      }
      toast.success("רשימת הקבוצות רועננה");
      qc.invalidateQueries({ queryKey: ["wa", "groups"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "רענון הקבוצות נכשל"),
  });

  const uploadMedia = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("ניתן להעלות קובץ תמונה בלבד");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("הקובץ גדול מדי (עד 15MB)");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `broadcasts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("broadcast-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data, error: signErr } = await supabase.storage
        .from("broadcast-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !data?.signedUrl) throw signErr ?? new Error("יצירת קישור נכשלה");
      setMediaUrl(data.signedUrl);
      toast.success("התמונה הועלתה וצורפה להפצה");
    } catch (e: any) {
      toast.error(e?.message ?? "העלאת המדיה נכשלה");
    } finally {
      setUploading(false);
    }
  };

  const create = useMutation({
    mutationFn: useServerFn(createBroadcast),
    onSuccess: (r: any) => {
      toast.success(`ההפצה נוצרה (${BROADCAST_STATUS_LABELS[r.status as "draft"]}) · ${r.targets} קבוצות. לא נשלחה הודעה.`);
      setSelected([]);
      setTitle("");
      setMessage("");
      setMediaUrl("");
      setScheduledFor("");
      qc.invalidateQueries({ queryKey: ["wa"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "יצירת הפצה נכשלה"),
  });

  const saveFolder = useMutation({
    mutationFn: useServerFn(saveGroupFolder),
    onSuccess: () => {
      toast.success("תיקיית הקבוצות נשמרה");
      setFolderName("");
      setEditingFolder(null);
      qc.invalidateQueries({ queryKey: ["wa", "folders"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שמירת התיקייה נכשלה"),
  });

  const removeFolder = useMutation({
    mutationFn: useServerFn(deleteGroupFolder),
    onSuccess: () => {
      toast.success("התיקייה נמחקה. הקבוצות עצמן לא שונו.");
      setEditingFolder(null);
      qc.invalidateQueries({ queryKey: ["wa", "folders"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "מחיקת התיקייה נכשלה"),
  });

  const toggleFolder = (id: string) => {
    const isOn = activeFolders.includes(id);
    const next = isOn ? activeFolders.filter((x) => x !== id) : [...activeFolders, id];
    setActiveFolders(next);
    setSelected((prev) => {
      if (isOn) {
        const folder = folders.find((f) => f.id === id);
        const stillNeeded = new Set(
          folders.filter((f) => next.includes(f.id)).flatMap((f) => f.group_ids),
        );
        const removed = new Set((folder?.group_ids ?? []).filter((g) => !stillNeeded.has(g)));
        return prev.filter((g) => !removed.has(g));
      }
      const merged = applyFoldersToSelection(prev, folders, next, groups as any);
      const added = merged.length - prev.length;
      const folder = folders.find((f) => f.id === id);
      if (added <= 0) {
        toast.message(`״${folder?.name ?? "תיקייה"}״ לא הוסיפה קבוצות חדשות (כפילות או קבוצות חסומות/ארכיון)`);
      } else {
        toast.success(`נוספו ${added} קבוצות מתוך ״${folder?.name ?? "תיקייה"}״`);
      }
      return merged;
    });
  };


  const submitFolder = () => {
    if (!bridge) {
      toast.error("אין חיבור WhatsApp Web Bridge מוגדר");
      return;
    }
    const others = folders
      .filter((f) => f.id !== editingFolder?.id)
      .map((f) => f.name);
    const check = validateFolderName(folderName, others);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    saveFolder.mutate({
      data: {
        id: editingFolder?.id ?? null,
        connection_id: bridge.id,
        name: check.name,
        group_ids: selected,
      },
    });
  };

  const cancel = useMutation({
    mutationFn: useServerFn(cancelBroadcast),
    onSuccess: () => {
      toast.success("ההפצה בוטלה");
      qc.invalidateQueries({ queryKey: ["wa", "broadcasts"] });
    },
  });

  const runNow = useMutation({
    mutationFn: useServerFn(runBroadcastNow),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(`נשלחו ${res.sent} · נכשלו ${res.failed} · נותרו ${res.remaining}`);
      } else {
        toast.error(`השליחה נעצרה: ${res?.reason ?? "שגיאה"}`);
      }
      qc.invalidateQueries({ queryKey: ["wa", "broadcasts"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const submit = () => {
    if (!bridge) {
      toast.error("אין חיבור WhatsApp Web Bridge מוגדר");
      return;
    }
    const draft = {
      title,
      message_text: message,
      media_url: mediaUrl || null,
      group_ids: selected,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      interval_seconds: Number(intervalSeconds) || DEFAULT_BROADCAST_INTERVAL_SECONDS,
    };
    const check = validateBroadcastDraft(draft);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    create.mutate({ data: { connection_id: bridge.id, ...draft } });
  };

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">הפצה לקבוצות WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          הפצה לקבוצות מתבצעת אך ורק דרך Alex Personal (WhatsApp Web Bridge). תמר / Meta API אינה משמשת כאן.
        </p>
      </div>

      {!bridge && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
          לא הוגדר חיבור הפצה. יש להגדיר את Alex Personal במסך{" "}
          <Link to="/settings/whatsapp-connections" className="underline font-medium">
            הגדרות · חיבורי WhatsApp
          </Link>
          .
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <span className="font-semibold">גשר Alex Personal:</span>
        {!bridgeStatus?.configured ? (
          <Badge variant="outline" className="bg-muted text-muted-foreground">שרת הגשר אינו מוגדר</Badge>
        ) : (
          <Badge
            variant="outline"
            className={
              bridgeStatus.connected
                ? "bg-green-500/10 text-green-700 border-green-500/30"
                : "bg-destructive/10 text-destructive border-destructive/30"
            }
          >
            {BRIDGE_STATE_LABELS[bridgeStatus.state]}
          </Badge>
        )}
        <span>
          מצב Control Plane: יצירה או תזמון של הפצה אינם שולחים דבר. שליחה חיה תתאפשר רק כשהגשר מחובר ומופעל בשרת.
        </span>
      </div>


      <Tabs defaultValue="compose" dir="rtl">
        <TabsList>
          <TabsTrigger value="compose">הפצה חדשה</TabsTrigger>
          <TabsTrigger value="groups">קבוצות ({groups.length})</TabsTrigger>
          <TabsTrigger value="queue">תור מתוזמן ({queued.length})</TabsTrigger>
          <TabsTrigger value="history">היסטוריה</TabsTrigger>
        </TabsList>


        <TabsContent value="compose" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תוכן ההפצה</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="שם פנימי להפצה" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea
                rows={6}
                placeholder="תוכן ההודעה לקבוצות…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">קישור מדיה (אופציונלי)</label>
                  <Input
                    dir="ltr"
                    placeholder="https://…"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="scheduled-for" className="text-xs font-medium text-muted-foreground">
                    מועד שליחה (ריק = טיוטה)
                  </label>
                  <Input
                    id="scheduled-for"
                    type="datetime-local"
                    dir="ltr"
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="interval-seconds" className="text-xs font-medium text-muted-foreground">
                    מרווח בין קבוצות (שניות)
                  </label>
                  <Input
                    id="interval-seconds"
                    type="number"
                    min={5}
                    max={3600}
                    dir="ltr"
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {scheduledFor ? (
                  <Badge variant="secondary">
                    ממתין לשליחה · {formatDate(new Date(scheduledFor).toISOString())}
                  </Badge>
                ) : (
                  <Badge variant="outline">נשמר כטיוטה — ללא מועד שליחה</Badge>
                )}
                {!!scheduledFor && (
                  <Button size="sm" variant="ghost" onClick={() => setScheduledFor("")}>
                    ניקוי מועד
                  </Button>
                )}
                <span className="text-muted-foreground">
                  השליחה מבוצעת בהפרשי זמן של {Number(intervalSeconds) || DEFAULT_BROADCAST_INTERVAL_SECONDS} שניות בין קבוצה לקבוצה, כדי להימנע מחסימה על ידי Meta.
                </span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void uploadMedia(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-md border-2 border-dashed p-4 text-center text-sm transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadMedia(file);
                    e.target.value = "";
                  }}
                />
                {uploading ? (
                  <span className="text-muted-foreground">מעלה תמונה…</span>
                ) : (
                  <span className="text-muted-foreground">
                    גררו לכאן תמונה/באנר או לחצו לבחירת קובץ (עד 15MB)
                  </span>
                )}
              </div>
              {!!mediaUrl && (
                <div className="flex items-center gap-3 rounded-md border border-border p-2">
                  <img
                    src={mediaUrl}
                    alt="תצוגה מקדימה של מדיית ההפצה"
                    loading="lazy"
                    className="h-16 w-16 rounded object-cover"
                  />
                  <span className="flex-1 truncate text-xs text-muted-foreground" dir="ltr">
                    {mediaUrl}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setMediaUrl("")}>
                    הסרה
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">בחירת קבוצות ({selected.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="text-sm font-semibold">תיקיות קבוצות (קהלים שמורים)</div>
                {!folders.length ? (
                  <p className="text-xs text-muted-foreground">
                    עדיין אין תיקיות. אפשר ליצור תיקייה מתוך הבחירה הנוכחית בלשונית ״קבוצות״.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {folders.map((f) => {
                      const counts = folderCounts(f, groups as any);
                      return (
                        <Button
                          key={f.id}
                          size="sm"
                          variant={activeFolders.includes(f.id) ? "default" : "outline"}
                          onClick={() => toggleFolder(f.id)}
                        >
                          {f.name} · {counts.effective}/{counts.total}
                        </Button>
                      );
                    })}
                    {!!activeFolders.length && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setActiveFolders([]);
                          setSelected([]);
                        }}
                      >
                        נקה תיקיות
                      </Button>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  בחירת תיקייה מוסיפה את הקבוצות שבה (ללא כפילויות). אפשר להוסיף או להסיר קבוצות ידנית לאחר מכן.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(groups.map((g) => g.id))}>
                  בחר הכל
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                  נקה בחירה
                </Button>
                {categories.map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={category === c ? "default" : "outline"}
                    onClick={() => {
                      setCategory(c);
                      setSelected(groups.filter((g) => g.category === c).map((g) => g.id));
                    }}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="חיפוש קבוצה לפי שם או חלק מהשם…"
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                />
                {!!groupQuery && (
                  <Button size="sm" variant="ghost" onClick={() => setGroupQuery("")}>
                    ניקוי חיפוש
                  </Button>
                )}
                <Badge variant="secondary">{visibleGroups.length} מוצגות</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ms-auto"
                  disabled={syncGroups.isPending}
                  onClick={() => syncGroups.mutate({} as any)}
                >
                  {syncGroups.isPending ? "מרענן…" : "רענון רשימת קבוצות"}
                </Button>
              </div>
              {!groups.length && (
                <div className="text-sm text-muted-foreground">
                  אין קבוצות מסונכרנות. יש ללחוץ על ״רענון רשימת קבוצות״ לאחר חיבור הגשר.
                </div>
              )}
              {!!groups.length && !visibleGroups.length && (
                <div className="text-sm text-muted-foreground">לא נמצאו קבוצות שתואמות לחיפוש</div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleGroups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-3 rounded-md border border-border p-2 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(g.id)}
                      disabled={!g.send_enabled}
                      onCheckedChange={(v) =>
                        setSelected((prev) => (v ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                      }
                    />
                    <span className="flex-1 truncate">{g.current_name}</span>
                    {g.category && <Badge variant="secondary">{g.category}</Badge>}
                    {!g.send_enabled && <Badge variant="outline">חסום לשליחה</Badge>}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Button disabled={!bridge || create.isPending} onClick={submit}>
            {scheduledFor ? "שמירה ותזמון (ללא שליחה)" : "שמירת טיוטה"}
          </Button>
        </TabsContent>

        <TabsContent value="groups" className="pt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תיקיות קבוצות (קהלים שמורים)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="שם תיקייה (למשל: טיולים, VIP)"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                />
                <Button size="sm" disabled={!bridge || saveFolder.isPending} onClick={submitFolder}>
                  {editingFolder ? `עדכון ״${editingFolder.name}״ (${selected.length} קבוצות)` : `שמירת תיקייה מהבחירה (${selected.length})`}
                </Button>
                {editingFolder && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingFolder(null);
                      setFolderName("");
                    }}
                  >
                    ביטול עריכה
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                התיקייה נשמרת במסד הנתונים ומשויכת ל-Alex Personal בלבד. מחיקת תיקייה אינה מוחקת קבוצות, והפצות קיימות שומרות את רשימת הקבוצות שנקבעה בזמן יצירתן.
              </p>

              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">בחירת קבוצות לתיקייה</span>
                  <Badge variant="secondary">{selected.length} נבחרו</Badge>
                  <div className="ms-auto flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(groups.filter((g) => g.send_enabled).map((g) => g.id))}
                    >
                      בחר הכל
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                      נקה בחירה
                    </Button>
                  </div>
                </div>
                {!groups.length ? (
                  <div className="text-xs text-muted-foreground">
                    אין קבוצות מסונכרנות. יש לסנכרן קבוצות מהגשר לפני יצירת קהל שמור.
                  </div>
                ) : (
                  <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className="flex items-center gap-3 rounded-md border border-border p-2 text-sm"
                      >
                        <Checkbox
                          checked={selected.includes(g.id)}
                          disabled={!g.send_enabled}
                          onCheckedChange={(v) =>
                            setSelected((prev) => (v ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                          }
                        />
                        <span className="flex-1 truncate">{g.current_name}</span>
                        {g.category && <Badge variant="secondary">{g.category}</Badge>}
                        {!g.send_enabled && <Badge variant="outline">חסום לשליחה</Badge>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {folders.map((f) => {
                  const counts = folderCounts(f, groups as any);
                  return (
                    <div
                      key={f.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <span className="font-medium">{f.name}</span>
                      <Badge variant="secondary">{counts.total} קבוצות</Badge>
                      {counts.effective !== counts.total && (
                        <Badge variant="outline">{counts.effective} זמינות לשליחה</Badge>
                      )}
                      <div className="ms-auto flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingFolder(f);
                            setFolderName(f.name);
                            setSelected(f.group_ids);
                          }}
                        >
                          עריכה
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeFolder.mutate({ data: { id: f.id } })}
                        >
                          מחיקה
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {!folders.length && <div className="text-xs text-muted-foreground">אין תיקיות שמורות</div>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">שם קבוצה</th>
                    <th className="p-2 text-start">קטגוריה</th>
                    <th className="p-2 text-start">שליחה</th>
                    <th className="p-2 text-start">נראתה לאחרונה</th>
                    <th className="p-2 text-start">מקור</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-border">
                      <td className="p-2">{g.current_name}</td>
                      <td className="p-2">{g.category ?? "—"}</td>
                      <td className="p-2">{g.send_enabled ? "פעילה" : "כבויה"}</td>
                      <td className="p-2">{g.last_seen_at ? formatDate(g.last_seen_at) : "—"}</td>
                      <td className="p-2">{bridge?.display_name ?? "—"}</td>
                    </tr>
                  ))}
                  {!groups.length && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-muted-foreground">
                        אין קבוצות
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="pt-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            טיוטות והפצות מתוזמנות שממתינות לביצוע, לפי מועד השליחה המתוכנן.
          </div>
          {queued.map((b) => {
            const done = (b.success_count ?? 0) + (b.failed_count ?? 0);
            const total = b.total_groups || 0;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <Card key={b.id}>
                <CardContent className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      to="/broadcasts/$id"
                      params={{ id: b.id }}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {b.title}
                    </Link>
                    <Badge variant="outline">{BROADCAST_STATUS_LABELS[b.status as "draft"] ?? b.status}</Badge>
                    <span className="text-muted-foreground">
                      {b.scheduled_for ? `ממתין לשליחה · ${formatDate(b.scheduled_for)}` : "ללא מועד — טיוטה"}
                    </span>
                    <span className="text-muted-foreground">
                      {total} קבוצות · מרווח {b.interval_seconds ?? DEFAULT_BROADCAST_INTERVAL_SECONDS} שניות
                    </span>
                    <Button
                      size="sm"
                      className="ms-auto"
                      disabled={runNow.isPending}
                      onClick={() => runNow.mutate({ data: { id: b.id } })}
                    >
                      {runNow.isPending ? "שולח…" : "שלח עכשיו"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ data: { id: b.id } })}>
                      ביטול
                    </Button>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    נשלחו {b.success_count} · נכשלו {b.failed_count} · ממתינות {b.pending_count}
                    {b.last_run_at ? ` · ריצה אחרונה ${formatDate(b.last_run_at)}` : ""}
                  </div>
                  {b.last_error && (
                    <div className="text-xs text-destructive">שגיאה אחרונה: {broadcastErrorLabel(b.last_error)}</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!queued.length && (
            <div className="text-sm text-muted-foreground">אין טיוטות או הפצות מתוזמנות בתור</div>
          )}
        </TabsContent>


        <TabsContent value="history" className="pt-4 space-y-2">
          {((historyQ.data ?? []) as any[]).map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Link
                  to="/broadcasts/$id"
                  params={{ id: b.id }}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {b.title}
                </Link>
                <Badge variant="outline">{BROADCAST_STATUS_LABELS[b.status as "draft"] ?? b.status}</Badge>
                <span className="text-muted-foreground">
                  סה״כ {b.total_groups} · נשלחו {b.success_count} · נכשלו {b.failed_count} · ממתינות {b.pending_count}
                </span>
                <span className="text-muted-foreground">{formatDate(b.created_at)}</span>
                {(b.status === "draft" || b.status === "queued") && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ data: { id: b.id } })}>
                    ביטול
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {!((historyQ.data ?? []) as any[]).length && (
            <div className="text-sm text-muted-foreground">עדיין אין הפצות</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
