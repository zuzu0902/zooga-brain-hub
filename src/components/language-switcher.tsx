import { Languages } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5 ${className ?? ""}`}
      role="group"
      aria-label={lang === "en" ? "Language" : "שפה"}
    >
      <Languages className="h-3.5 w-3.5 text-muted-foreground mx-1.5 shrink-0" />
      <Button
        type="button"
        size="sm"
        variant={lang === "he" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        aria-pressed={lang === "he"}
        onClick={() => setLang("he")}
      >
        עברית
      </Button>
      <Button
        type="button"
        size="sm"
        variant={lang === "en" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        aria-pressed={lang === "en"}
        onClick={() => setLang("en")}
      >
        English
      </Button>
    </div>
  );
}