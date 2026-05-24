import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import { formatRelative } from "@/lib/i18n";

const MESSAGE_TYPES = new Set([
  "whatsapp_message",
  "whatsapp_inbound",
  "whatsapp_outbound",
  "message",
  "chat",
  "tamar_message",
]);

export function ContactConversation({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: rows } = useQuery({
    queryKey: ["conversation", contactId],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data } = await supabase
        .from("interactions")
        .select("*")
        .eq("contact_id", contactId)
        .order("timestamp", { ascending: true })
        .limit(200);
      return (data ?? []).filter((i: any) =>
        MESSAGE_TYPES.has(String(i.type)) || (i.content && i.source)
      );
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`conv-${contactId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interactions", filter: `contact_id=eq.${contactId}` },
        () => qc.invalidateQueries({ queryKey: ["conversation", contactId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [contactId, qc]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">שיחת Tamar</h3>
        <Badge variant="outline" className="text-[10px]">{rows?.length ?? 0}</Badge>
      </div>
      <div ref={scrollRef} className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {(rows?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            אין הודעות עדיין בשיחה.
          </div>
        ) : (
          rows!.map((m: any) => {
            const outbound =
              String(m.type).includes("outbound") ||
              String(m.source ?? "").toLowerCase().includes("tamar") ||
              String(m.source ?? "").toLowerCase().includes("bot");
            return (
              <div
                key={m.id}
                className={`p-2.5 rounded-lg border max-w-[88%] ${
                  outbound ? "bg-primary/5 mr-auto" : "bg-card ml-auto"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px]">
                    {outbound ? "Tamar" : "Lead"} · {m.source ?? m.type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(m.timestamp)}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">{m.content || "—"}</div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}