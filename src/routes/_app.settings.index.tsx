import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { LanguageSwitcher } from "@/components/language-switcher";
export const Route = createFileRoute("/_app/settings/")({ head: () => operatorHead("הגדרות", "העדפות התצוגה במרכז השליטה של זוגה."), component: Settings });
function Settings() { return <div className="p-4 md:p-6 space-y-6" dir="rtl"><h1 className="text-2xl font-bold">הגדרות</h1><section className="border-y py-5 flex items-center justify-between gap-4 max-w-xl"><h2 className="font-medium">שפה</h2><LanguageSwitcher /></section></div>; }