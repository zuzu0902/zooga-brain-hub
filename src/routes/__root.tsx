import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider, useT, useLanguage } from "@/lib/language-context";
import { Toaster } from "sonner";

function NotFoundComponent() {
  const t = useT();
  const { dir } = useLanguage();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" dir={dir}>
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("העמוד לא נמצא")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("העמוד שחיפשת לא קיים או הועבר.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("חזרה לדשבורד")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const t = useT();
  const { dir } = useLanguage();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" dir={dir}>
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("העמוד לא נטען")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("משהו השתבש. אפשר לרענן או לחזור לדשבורד.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("נסה שוב")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("חזרה לדשבורד")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Zooga OS" },
      { name: "description", content: "מערכת ה-CRM של קהילת זוגה" },
      { name: "author", content: "Zooga" },
      { property: "og:title", content: "Zooga OS" },
      { property: "og:description", content: "מערכת ה-CRM של קהילת זוגה" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Zooga OS" },
      { name: "twitter:description", content: "מערכת ה-CRM של קהילת זוגה" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4bb088d5-da90-476f-8d2d-63c1628ac22e/id-preview-77ca7d9e--63da89d1-c593-41f4-9c3f-89806f28874d.lovable.app-1778164620398.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4bb088d5-da90-476f-8d2d-63c1628ac22e/id-preview-77ca7d9e--63da89d1-c593-41f4-9c3f-89806f28874d.lovable.app-1778164620398.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&family=Assistant:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <Outlet />
          <AppToaster />
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function AppToaster() {
  const { dir } = useLanguage();
  return <Toaster richColors position="top-center" dir={dir} />;
}
