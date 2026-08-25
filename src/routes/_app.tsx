import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useT, useLanguage } from "@/lib/language-context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Inbox,
  Tag,
  Send,
  Settings,
  LogOut,
  Upload,
  Megaphone,
  CheckSquare,
  Flag,
  Sparkles,
  Bot,
  Activity,
  BellRing,
  Brain,
  ShieldCheck,
  Radio,
  ChevronDown,
  Wrench,
  MessageCircle,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

type NavItem = { to: string; label: string; icon: any; exact?: boolean };
type NavEntry = NavItem | { label: string; icon: any; children: NavItem[] };

const PRIMARY_NAV: NavEntry[] = [
  { to: "/", label: "מרכז שליטה", icon: LayoutDashboard, exact: true },
  { to: "/contacts", label: "אנשים", icon: Users },
  { to: "/inbox", label: "שיחות", icon: Inbox },
  { to: "/tasks", label: "משימות", icon: CheckSquare },
  {
    label: "קמפיינים ומכירות",
    icon: Megaphone,
    children: [
      { to: "/offers", label: "הצעות", icon: Tag },
      { to: "/campaigns", label: "ניהול קמפיינים", icon: Megaphone },
      { to: "/send-offer", label: "שליחת הצעה", icon: Send },
      { to: "/import-leads", label: "ייבוא לידים", icon: Upload },
      { to: "/intake-campaign", label: "קמפיין אינטייק", icon: Megaphone },
    ],
  },
  {
    label: "WhatsApp",
    icon: MessageCircle,
    children: [
      { to: "/settings/whatsapp-connections", label: "חיבורי WhatsApp", icon: Radio },
      { to: "/broadcasts", label: "הפצה לקבוצות", icon: Radio },
    ],
  },
  { to: "/settings/api", label: "הגדרות", icon: Settings },
];

const ADVANCED_NAV: NavItem[] = [
  { to: "/settings/tamar-studio", label: "Tamar Studio", icon: Sparkles },
  { to: "/settings/tamar-brain", label: "Brain", icon: Brain },
  { to: "/runtime-trace", label: "Runtime Trace", icon: Activity },
  { to: "/zero-loss", label: "Zero-Loss Control", icon: ShieldCheck },
  { to: "/settings/tamar-blocks", label: "Prompt Blocks", icon: Bot },
  { to: "/tamar-lite", label: "Tamar Lite (Shadow)", icon: Bot },
  { to: "/settings/tamar", label: "Tamar Behavior", icon: Bot },
  { to: "/ai-assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/handoff", label: "Handoff Console", icon: Flag },
  { to: "/manager-alerts", label: "Manager Alerts", icon: BellRing },
];

function isActivePath(pathname: string, item: NavItem) {
  return item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(item.to + "/");
}

function AppLayout() {
  const { user, isAdmin, loading, signOut } = useAuth();
  const t = useT();
  const { dir } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { next: undefined }, replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        {t("טוען…")}
      </div>
    );
  }
  if (!user) return null;

  const linkClass = (active: boolean, nested = false) =>
    `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${nested ? "ms-3" : ""} ${
      active
        ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
        : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    }`;

  const advancedActive = ADVANCED_NAV.some((i) => isActivePath(location.pathname, i));

  const sidebar = (
    <aside className="w-64 shrink-0 h-screen sticky top-0 bg-sidebar text-sidebar-foreground border-l border-r border-sidebar-border flex flex-col">
      <div className="p-5 border-b border-sidebar-border flex items-center gap-3">
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground font-bold shadow-lg"
          style={{ background: "var(--gradient-warm)" }}
        >
          Z
        </div>
        <div>
          <div className="font-bold tracking-tight">Zooga OS</div>
          <div className="text-[11px] text-sidebar-foreground/60">{t("מערכת ניהול קהילה")}</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-auto">
        {PRIMARY_NAV.map((entry) => {
          if ("children" in entry) {
            const groupActive = entry.children.some((c) => isActivePath(location.pathname, c));
            const Icon = entry.icon;
            return (
              <Collapsible key={entry.label} defaultOpen={groupActive}>
                <CollapsibleTrigger
                  className={`group w-full ${linkClass(false)} ${
                    groupActive ? "text-sidebar-foreground font-medium" : ""
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1 text-start">{t(entry.label)}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-1">
                  {entry.children.map((child) => {
                    const ChildIcon = child.icon;
                    return (
                      <Link
                        key={child.to}
                        to={child.to}
                        className={linkClass(isActivePath(location.pathname, child), true)}
                      >
                        <ChildIcon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t(child.label)}</span>
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          }
          const Icon = entry.icon;
          return (
            <Link
              key={entry.to}
              to={entry.to}
              className={linkClass(isActivePath(location.pathname, entry))}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(entry.label)}</span>
            </Link>
          );
        })}

        <div className="pt-4">
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="group w-full flex items-center gap-3 px-3 py-2 rounded-md border border-dashed border-sidebar-border/80 bg-sidebar-accent/30 text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <Wrench className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 text-start">{t("מערכת מתקדמת")}</span>
              {advancedActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-1">
              {ADVANCED_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={linkClass(isActivePath(location.pathname, item), true)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(item.label)}</span>
                  </Link>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/70 mb-2 px-2 truncate">{user.email}</div>
        <Button
          onClick={signOut}
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t("התנתק")}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-background" dir={dir}>
      <div className="hidden md:flex">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 end-0 flex">{sidebar}</div>
        </div>
      )}

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/85 backdrop-blur px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t("תפריט")}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <span className="md:hidden font-bold tracking-tight">Zooga OS</span>
          <div className="flex-1" />
          <LanguageSwitcher />
        </header>
        {!isAdmin && (
          <div className="m-4 p-4 rounded-md border border-warning/40 bg-warning/10 text-sm">
            <div className="font-semibold mb-1">{t("חשבון ללא הרשאות מנהל")}</div>
            <div className="text-muted-foreground">
              {t("המשתמש")} <span className="font-mono">{user.email}</span>{" "}
              {t("מחובר אך אינו מוגדר כ-admin, לכן כל הנתונים מסוננים על ידי RLS ויופיעו ריקים. המשתמש הראשון שנרשם הופך אוטומטית ל-admin. אם זה אינו המקרה, יש להוסיף שורה בטבלת user_roles עם role=admin עבור user_id זה.")}
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
