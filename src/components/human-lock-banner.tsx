/**
 * Makes the human lock visible: who holds the conversation and since when,
 * so a thread can never be silently frozen for Tamar.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { getContactLock } from "@/lib/handoff.functions";
import { describeLockHolder, type LockSnapshot } from "@/lib/handoff-release-core";
import { formatRelative } from "@/lib/i18n";
import { useT } from "@/lib/language-context";

export function HumanLockBanner({ contactId, onRelease }: { contactId: string; onRelease: () => void }) {
  const t = useT();
  const lockFn = useServerFn(getContactLock);
  const { data } = useQuery({
    queryKey: ["contact-lock", contactId],
    queryFn: () => lockFn({ data: { contactId } }) as Promise<LockSnapshot>,
  });

  if (!data || (!data.humanOwned && data.openHandoffs === 0)) return null;

  return (
    <Card className="p-4 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/5">
      <div className="flex items-center gap-2 text-sm">
        <Lock className="h-4 w-4 text-amber-600" />
        <span className="font-medium">{t("השיחה מוחזקת אנושית")}</span>
        <span className="text-muted-foreground">
          · {describeLockHolder(data)}
          {data.humanOwnedAt ? ` · ${formatRelative(data.humanOwnedAt)}` : ""}
          {data.openHandoffs > 0 ? ` · ${data.openHandoffs} ${t("פניות פתוחות")}` : ""}
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={onRelease}>{t("החזר לתמר")}</Button>
    </Card>
  );
}
