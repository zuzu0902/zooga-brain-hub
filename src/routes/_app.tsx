import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useEffect } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const NAV_GROUPS: { label: string; items: { to: string; label: string; icon: any; exact?: boolean }[] }[] = [
  {
    label: "ראשי",
    items: [
      { to: "/", label: "דשבורד", icon: LayoutDashboard, exact: true },
      { to: "/contacts", label: "אנשי קשר", icon: Users },
      { to: "/inbox", label: "תיבת קליטה", icon: Inbox },
      { to: "/tasks", label: "משימות", icon: CheckSquare },
      { to: "/handoff", label: "Handoff Console", icon: Flag },
    ],
  },
  {
    label: "שיווק ומכירות",
    items: [
      { to: "/offers", label: "הצעות", icon: Tag },
      { to: "/campaigns", label: "ניהול קמפיינים", icon: Megaphone },
      { to: "/send-offer", label: "שליחת הצעה", icon: Send },
      { to: "/import-leads", label: "ייבוא לידים", icon: Upload },
      { to: "/intake-campaign", label: "קמפיין אינטייק", icon: Megaphone },
    ],
  },
  {
    label: "מערכת",
    items: [
      { to: "/ai-assistant", label: "AI Assistant", icon: Sparkles },
      { to: "/settings/tamar", label: "Tamar Behavior", icon: Bot },
      { to: "/settings/tamar-blocks", label: "Prompt Blocks", icon: Bot },
      { to: "/settings/api", label: "הגדרות API", icon: Settings },
    ],
  },
];

function AppLayout() {
  const { user, isAdmin, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        טוען…
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen flex bg-background" dir="rtl">
      <aside className="w-64 bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col">
        <div className="p-5 border-b border-sidebar-border flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground font-bold shadow-lg"
            style={{ background: "var(--gradient-warm)" }}
          >
            Z
          </div>
          <div>
            <div className="font-bold tracking-tight">Zooga CRM</div>
            <div className="text-[11px] text-sidebar-foreground/60">מערכת ניהול קהילה</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-5 overflow-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = item.exact
                    ? location.pathname === item.to
                    : location.pathname === item.to ||
                      location.pathname.startsWith(item.to + "/");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          {user ? (
            <>
              <div className="text-xs text-sidebar-foreground/70 mb-2 px-2 truncate">{user.email}</div>
              <Button
                onClick={signOut}
                variant="ghost"
                className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
                התנתק
              </Button>
            </>
          ) : (
            <div className="text-[11px] text-sidebar-foreground/70 px-2 py-1.5 rounded bg-sidebar-accent/40 text-center">
              מצב פיתוח · ללא התחברות
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        {!isAdmin && (
          <div className="m-4 p-4 rounded-md border border-warning/40 bg-warning/10 text-sm">
            <div className="font-semibold mb-1">חשבון ללא הרשאות מנהל</div>
            <div className="text-muted-foreground">
              המשתמש <span className="font-mono">{user.email}</span> מחובר אך אינו מוגדר כ-admin, לכן כל הנתונים מסוננים על ידי RLS ויופיעו ריקים.
              המשתמש הראשון שנרשם הופך אוטומטית ל-admin. אם זה אינו המקרה, יש להוסיף שורה בטבלת <span className="font-mono">user_roles</span> עם role=admin עבור user_id זה.
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}