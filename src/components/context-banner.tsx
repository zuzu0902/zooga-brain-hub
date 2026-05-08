import { useEffect, useState } from "react";
import { X, Lightbulb } from "lucide-react";

export function ContextBanner({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `ctx-banner-dismissed:${id}`;
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(typeof window !== "undefined" && !localStorage.getItem(key)); }, [key]);
  if (!show) return null;
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3 text-sm">
      <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 text-foreground/80">{children}</div>
      <button
        onClick={() => { localStorage.setItem(key, "1"); setShow(false); }}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="סגור"
      ><X className="h-4 w-4" /></button>
    </div>
  );
}
