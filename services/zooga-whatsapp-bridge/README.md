# ZOOGA OS — WhatsApp Web Bridge (Alex Personal)

External service for the **Alex Personal** WhatsApp identity. Deployed separately
(Hostinger / VPS, Docker). It is **not** part of the Lovable app runtime.

## Hard separation (do not break)

| Identity | Transport | Scope | Uses this bridge |
| --- | --- | --- | --- |
| Tamar Business | Meta Cloud API | 1:1 customer conversations | **Never** |
| Alex Personal | WhatsApp Web (Baileys) | Zooga's own WhatsApp **groups** | Only this |

- Tamar/Meta code must never import, call or reference this service.
- This bridge has **no 1:1 sending endpoint** — group JIDs (`...@g.us`) only.
- The Lovable control plane never sends messages itself; it only calls this API.

## ⚠️ Operator warning

This is an **unofficial** WhatsApp integration built on the WhatsApp Web protocol
(`@whiskeysockets/baileys`, pinned to **7.0.0-rc14**). It is not the official
WhatsApp Business API and is not endorsed by WhatsApp/Meta. Using it carries a
real risk that the connected personal number gets rate-limited or banned.

Permitted use: posting Zooga's own announcements to **groups Zooga already owns
or participates in**, at human pace, to people who joined those groups.

Forbidden: spam, unsolicited messaging, cold outreach, bulk 1:1 messaging,
scraping participants, buying/importing contact lists.

## Requirements

- Node.js 20+
- A persistent volume mounted at `/data` (session + idempotency ledger)

## Configuration

Copy `.env.example` to `.env` and fill it. All secrets are environment-only —
never committed, never stored in Supabase, never returned by an endpoint.

| Variable | Purpose |
| --- | --- |
| `BRIDGE_API_KEY` | Inbound bearer auth from the Zooga control plane (min 24 chars) |
| `CONTROL_PLANE_CALLBACK_SECRET` | Reserved for future signed callbacks |
| `SESSION_DIR` | Baileys multi-file auth state (default `/data/session`) |
| `DATA_DIR` | Idempotency ledger location (default `/data`) |
| `PORT` | HTTP port (default 8080) |
| `TRUST_PROXY`, `ALLOWED_ORIGIN` | Optional hardening behind a reverse proxy |
| `MIN_SEND_INTERVAL_MS`, `MAX_SENDS_PER_MINUTE`, `SEND_JITTER` | Send pacing |

## Run

```bash
npm install
npm run build
npm start
# tests
npm test
```

Docker:

```bash
docker build -t zooga-whatsapp-bridge .
docker run -d --name zooga-bridge \
  -p 8080:8080 \
  -v zooga-bridge-data:/data \
  --env-file .env \
  zooga-whatsapp-bridge
```

## API

All routes except `GET /health` require `Authorization: Bearer $BRIDGE_API_KEY`
(constant-time comparison). Responses are sanitized JSON — no auth state, no
participant JIDs, no phone numbers, no raw provider payloads.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Service health/version only |
| GET | `/v1/status` | `state`, `connected`, `last_connected_at`, `last_disconnect_reason` category, `qr_available`, `service_version` |
| POST | `/v1/connect` | Starts/ensures the session. Returns connected, or `qr_available=true` |
| GET | `/v1/qr` | Short-lived QR (`qr_text` + `qr_data_url`), memory-only, TTL 60s. `409 qr_not_available` otherwise |
| POST | `/v1/disconnect` | Graceful socket close; auth files preserved |
| POST | `/v1/logout` | Destructive. Requires `X-Confirm-Logout: alex-personal`. Revokes via Baileys, then clears `SESSION_DIR` |
| GET | `/v1/groups` | Groups the account currently participates in: `chat_id`, `name`, optional `participant_count`, `is_announcement`, `is_admin` |
| POST | `/v1/send-group` | `{ chat_id, text, media_url?, idempotency_key }` → `{ ok, duplicate, message_id?, timestamp? }` |

### Session states

`not_configured` → `waiting_for_qr` → `connecting` → `connected` → `disconnected` / `error`

Transient disconnects reconnect with bounded exponential backoff (2s → 60s, max
6 attempts). A remote logout does **not** delete session files — only
`POST /v1/logout` does.

### Sending safety

- Group JIDs only; non-group ids are rejected with `not_a_group_chat_id`.
- One group per request. There is no bulk endpoint — the control plane loops.
- `idempotency_key` is mandatory and stored (hashed) in a 7-day ledger, so
  retries return `duplicate: true` instead of re-sending.
- Rate limits: 1 send / 2s and a per-minute cap; excess returns `429` with
  `Retry-After`.
- Optional bounded jitter (0.5–1.5s) before each send.
- The bridge never sends autonomously — only on an authenticated HTTP request.

### Media

**Images only in this batch** (`image/jpeg`, `image/png`, `image/webp`), fetched
server-side over https with a timeout and a ~10 MB cap, never written to disk.
Video/PDF are intentionally not implemented yet. Text sending has no media
dependency.

## Logging

Structured JSON with fixed codes only. Phone numbers, JIDs, chat ids, message
bodies, QR payloads and session material are redacted or never logged.
