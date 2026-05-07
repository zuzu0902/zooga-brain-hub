import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  Users,
  Inbox,
  Tag,
  Send,
  Settings,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const NAV = [
  { to: "/", label: "דשבורד", icon: LayoutDashboard, exact: true },
  { to: "/contacts", label: "אנשי קשר", icon: Users },
  { to: "/inbox", label: "תיבת קליטה", icon: Inbox },
  { to: "/offers", label: "הצעות", icon: Tag },
  { to: "/send-offer", label: "שליחת הצעה", icon: Send },
  { to: "/settings/api", label: "הגדרות API", icon: Settings },
];

function AppLayout() {
  const { user, isAdmin, loading, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex" dir="rtl">
      <aside className="w-64 bg-sidebar border-l border-sidebar-border flex flex-col">
        <div className="p-5 border-b border-sidebar-border flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-primary-foreground font-bold"
            style={{ background: "var(--gradient-warm)" }}
          >
            Z
          </div>
          <div>
            <div className="font-bold text-sidebar-foreground">Zooga CRM</div>
            <div className="text-xs text-muted-foreground">מערכת קהילה</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          {user ? (
            <>
              <div className="text-xs text-muted-foreground mb-2 px-2 truncate">{user.email}</div>
              <Button onClick={signOut} variant="ghost" className="w-full justify-start gap-2">
                <LogOut className="h-4 w-4" />
                התנתק
              </Button>
            </>
          ) : (
            <div className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted/50 text-center">
              מצב פיתוח · ללא התחברות
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}