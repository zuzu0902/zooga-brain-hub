# Roadmap

## Focused catalog form update
- [x] Add factual event_knowledge round trip and card indicator through Core only.
- [x] Replace currency free text with ISO options, preserving existing other codes.
- [x] Verify focused tests and automatic build; no publish or live data writes.
- Results: 21 tests passed; automatic build OK; authenticated Core GET 200 via test-only relay; desktop/mobile form and currency selection checked without saving. Live event_knowledge persistence and standalone typecheck were not verified.

- [x] Implement the approved Tamar canonical conversation policy within scope.
- [x] Add focused behavior tests for post-consent onboarding, anti-spam, Hebrew cleanliness, and concierge voice.
- [x] Run affected tests, typecheck, and production build; report results before publishing.
- [x] Fresh concierge override: no unprompted destinations, exact first-inbound greeting, database-only output_text audit.
- [x] Replace Tamar’s canonical First Inbound Response in code, active database prompt, and tests; verify and publish.
- [x] Intake campaign page streamline — completed in previous work.
- [x] Migrate dashboard, contacts list/detail, offers/catalog UI to Hostinger Core API (no deploy).
- [x] Refactor Hebrew operator navigation and Core-only Command Center.
- [x] Remove direct database reads from daily contact/conversation/task/handoff views without changing delivery.
- [x] Verify authenticated Core response, focused tests, desktop/mobile behavior; do not publish.

## Verification and limitations
- 19 focused tests passed; automatic preview build OK.
- Authenticated Core GET returned 200; real-data UI showed 45 contacts, 66 active conversations, 0 handoffs, 1 open task.
- Contact detail and conversations tab rendered; desktop/mobile checked with no mobile overflow or runtime errors.
- Localhost browser origin is blocked by Core CORS. Success-state UI verification used test-only request relay with the actual browser session bearer and real GET responses; no application proxy or Core configuration changes. Embedded-origin connectivity remains unverified.
- Full conversation history, memory/intake, task editing and handoff release are explicitly unavailable; no database fallback.
- Existing legacy/developer and sending routes retained unchanged outside daily navigation. Group/broadcast/bridge/runtime/schema untouched. No messages, records or deployment changed.
- Git commits are managed by the platform; no manual commit was created.

## Exact changed files for this refactor
- `src/lib/hostinger-core/client.ts`
- `src/lib/hostinger-core/control-center.ts`
- `src/lib/hostinger-core/use-control-center.ts`
- `src/lib/hostinger-core/operator-head.ts`
- `src/lib/__tests__/control-center.test.ts`
- `src/components/command-center.tsx`
- `src/components/operator-data.tsx`
- `src/components/operator-contact.tsx`
- `src/routes/__root.tsx`
- `src/routes/_app.tsx`
- `src/routes/_app.index.tsx`
- `src/routes/_app.contacts.tsx`
- `src/routes/_app.contacts.index.tsx`
- `src/routes/_app.contacts.$id.tsx`
- `src/routes/_app.inbox.tsx`
- `src/routes/_app.tasks.tsx`
- `src/routes/_app.handoff.tsx`
- `src/routes/_app.catalog.tsx`
- `src/routes/_app.settings.tsx`
- `src/routes/_app.settings.index.tsx`
- `src/routes/_app.operator-diagnostics.tsx`
- `src/routeTree.gen.ts` (automatically regenerated)
- `AGENTS.md`, `roadmap.md` and project guardrail memories

## Catalog learn error-diagnosis hotfix
- [x] Preserve Core's `{ ok:false, code }` value in CoreApiError instead of collapsing it to request_failed.
- [x] Map the eight documented learn failure codes to concise Hebrew messages with a generic fallback.
- [x] Add focused tests for code preservation and displayed message; run tests, typecheck, build; do not publish.
- Results: 27 tests passed (15 catalog + 12 client), typecheck clean, automatic build OK. No routes, backend ownership, auth, catalog data, WhatsApp, campaigns or group broadcasts changed. Not published.
- Changed files: `src/lib/hostinger-core/client.ts`, `src/lib/hostinger-core/catalog.ts`, `src/routes/_app.catalog.tsx`, `src/lib/__tests__/core-catalog.test.ts`.
