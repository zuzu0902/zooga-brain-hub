## Goal

Add a language switcher to the app so the entire CRM interface can be flipped from Hebrew (default) to full English for live demos — layout direction included.

## What the user gets

- A small language control (עב / EN) in a top bar on every app page.
- Clicking it instantly switches all interface text to English: navigation, page titles, buttons, table headers, form labels, filters, badges, status/source/interest labels, empty states, toasts, dialogs, error and 404 screens, login page.
- The whole layout flips from right-to-left to left-to-right in English, and back to RTL in Hebrew.
- The choice is remembered in the browser, so a demo stays in English across page navigation and refresh. Default for a fresh visitor stays Hebrew.

## Scope boundary (important)

Only the **admin interface** gets translated. Anything Tamar says to real customers over WhatsApp — the runtime prompt layers, reply generation, catalog lists, handoff receipts, intake question wording — stays Hebrew, unchanged. Customer-facing data stored in the database (contact names, offer titles, message content, notes) is displayed as-is in both languages; it is not machine-translated.

## Technical approach

1. **Translation layer** — extend `src/lib/i18n.ts` into a dictionary keyed by string id with `he` and `en` values, covering all existing label maps (status, source, interests, lifestyle, category, spending, income, interaction type, channel, message status, sales temp, task status/priority) plus a new `ui.*` namespace for page and component copy.
2. **Language context** — new `src/lib/language-context.tsx` providing `lang`, `setLang`, `t(key, vars?)`, and `dir`. Persists to `localStorage`, hydration-safe (reads storage in an effect so SSR and first paint stay Hebrew, no mismatch). Mounted in `src/routes/__root.tsx` inside `AuthProvider`.
3. **Direction handling** — the provider sets `dir` and `lang` on the `<html>` element at runtime; `__root.tsx` keeps `he`/`rtl` as the server-rendered default. Hardcoded `dir="rtl"` on dialogs and page wrappers becomes dynamic.
4. **Date/number formatting** — `formatDate` / `formatRelative` become locale-aware (`he-IL` vs `en-US`), including the relative strings ("לפני 3 שעות" / "3h ago").
5. **Switcher UI** — new `src/components/language-switcher.tsx`, placed in a slim header bar added to `src/routes/_app.tsx` above `<Outlet />` (the layout currently has no top bar). Also shown on the login page so a demo can start in English.
6. **Screen-by-screen conversion** — replace literal Hebrew strings with `t()` calls across the ~30 UI files: layout/nav, dashboard, contacts list + contact detail (the largest single file), inbox, tasks, handoff, manager alerts, runtime trace, offers list + detail, campaigns list/new/detail, send-offer, import-leads, intake-campaign, AI assistant, Tamar settings pages, API settings, login, root error/404, and the shared components (conversation, create dialog, context banner, campaign form, offer picker, AI intelligence panel).
7. **Verification** — load the app, flip to English, walk each route in a headless browser to confirm no Hebrew leaks in the chrome and no RTL/LTR layout breakage, then flip back.

## Notes

- Route `head()` titles/descriptions stay Hebrew (SEO metadata; not part of the demo surface) unless you want those switched too.
- No database or backend changes.
