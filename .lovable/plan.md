# Streamlined Intake Campaign page

Goal: one clean page where Alex pastes numbers, picks a template, launches, and watches the last 50 sends.

## Page layout (top to bottom)
1. **Paste box** — large textarea, one number per line (optional name after a comma or tab: `0541234567, דנה`). Live preview under it: "X valid numbers, Y invalid, Z duplicates removed".
2. **Template dropdown** — only Meta-approved templates, `tamar_intro` pre-selected (falls back to the first approved one with a warning if it's missing).
3. **"Launch campaign" button** — confirmation dialog showing count and template, then sends to the Hostinger Gateway. Toast: "Accepted by gateway — N contacts, 5 seconds apart".
4. **Recent sends table** — last 50: phone (masked middle digits), name, send time, and a "Replied" / "No reply yet" badge. Auto-refreshes every 15 seconds.
5. **"Advanced" collapsible (closed by default)** — the existing tools, unchanged: choose from imported leads, batch size, pause/stop/retry, check template against Meta.

## Number cleanup (in the browser)
- Strip spaces, dashes, brackets, dots, `+`.
- `05XXXXXXXX` becomes `9725XXXXXXXX`; `5XXXXXXXX` (9 digits) becomes `9725XXXXXXXX`; `972...` kept as is; `00972...` becomes `972...`.
- Reject anything not 11-15 digits after cleanup, and anything with `@` (group IDs). Duplicates removed.

## Sending
- Button calls a new server function (token never reaches the browser), which POSTs to `https://gateway.zooga-os.segapo.com/v1/campaign/trigger` with header `X-Zooga-Token` and body `{template_name, language_code:"he", delay_seconds:5, contacts:[{phone, name}]}`.
- Success = HTTP 202. Any other status shows a clear error; nothing is retried automatically, so no double sends.
- Limit: 500 numbers per launch, admin sign-in required.

## Status tracking
Per your choice, pasted numbers are **not** added to the contact list. To still show the table, each launch writes a small send-log row per number (phone, name, template, time, gateway result) in a new dedicated log table. "Replied" is shown when an incoming WhatsApp message from that phone exists after the send time.

## Not touched
Group sending/broadcasts, the Tamar conversation engine, tamar-turn / tamar-generate, the existing campaign server functions.

## Please note
Sending without first recording contacts skips the usual consent-first pilot record. The template itself acts as the opening message; opt-outs replying "stop" are still handled by the normal inbound flow once they answer.

## Technical details
- Files: rewrite `src/routes/_app.intake-campaign.tsx` (existing panel moved into an `<Collapsible>`); new `src/lib/phone-bulk.ts` (pure parser + tests); new `src/lib/gateway-campaign.functions.ts` (`requireSupabaseAuth` + `is_admin` check, zod: contacts 1..500, phone `^972\d{8,12}$`, name max 80, template max 120; `delay_seconds` fixed server-side at 5); gateway URL + token read inside handler from the existing gateway config/secret (verify name; request via add_secret only if absent).
- Migration: `gateway_campaign_dispatches` (id, batch_id, phone, name, template_name, dispatched_at, gateway_status int, created_by) with GRANTs, RLS admin-only select/insert, index on dispatched_at desc.
- Reply badge: one query against `messages` for inbound rows whose normalized phone is in the 50 phones, compared client-side to dispatched_at.
- Tests: parser cases (local/intl/00/garbage/dup/@), server fn builds exact payload with `delay_seconds:5`, non-202 returns error without logging, no phone/token in logs. Then typecheck, full suite, build, publish.
