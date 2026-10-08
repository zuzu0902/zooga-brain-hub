# Roadmap

- [x] Implement the approved Tamar canonical conversation policy within scope.
- [x] Add focused behavior tests for post-consent onboarding, anti-spam, Hebrew cleanliness, and concierge voice.
- [x] Run affected tests, typecheck, and production build; report results before publishing.
- [x] Fresh concierge override: no unprompted destinations, exact first-inbound greeting, database-only output_text audit.
- [x] Replace Tamar’s canonical First Inbound Response in code, active database prompt, and tests; verify and publish.
- [x] Intake campaign page streamline — completed in previous work.
- [x] Migrate dashboard, contacts list/detail, offers/catalog UI to Hostinger Core API (no deploy).
- [ ] Refactor Hebrew operator navigation and Core-only Command Center.
- [ ] Remove direct database reads from daily contact/conversation/task/handoff views without changing delivery.
- [ ] Verify authenticated Core response, focused tests, desktop/mobile behavior; do not publish.
