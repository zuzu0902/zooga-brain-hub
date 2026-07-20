
# MCP OAuth connection details

You named `https://mcp.lovable.dev` — that's Lovable's project-editing MCP server, operated by Lovable, not by this project. I'm not the owner of its OAuth server, so the only correct way to get its exact values is via the MCP OAuth discovery chain (that's how Claude/ChatGPT/Cursor get them too — none of them are hardcoded). I'm giving you the discovery pointers for it, plus fully concrete values for **this app's own MCP server** at `https://zooga-brain-hub.lovable.app/mcp` in case that's what your bridge actually needs.

No code changes in this plan — this is a configuration answer. If you want me to add anything (e.g. a manual OAuth client pre-registered), tell me which server.

---

## A. `https://mcp.lovable.dev` (Lovable's project-editing MCP)

Standards-based MCP clients don't hardcode auth URLs — they discover them. Point your bridge at:

- **MCP endpoint** — `https://mcp.lovable.dev/mcp` (or `/sse`, depending on the transport your client uses; try `/mcp` first — Streamable HTTP)
- **Protected-resource metadata (RFC 9728)** — `https://mcp.lovable.dev/.well-known/oauth-protected-resource`
  - This document returns the `authorization_servers[]` list — that is the authoritative issuer for tokens.
- **Authorization-server metadata (RFC 8414)** — fetch `<issuer>/.well-known/oauth-authorization-server` using the issuer from the step above. That document contains the exact fields you asked for:
  - `authorization_endpoint`
  - `token_endpoint`
  - `registration_endpoint` (dynamic client registration)
  - `code_challenge_methods_supported` (`S256` — PKCE required)
  - `scopes_supported`

- **Client ID** — do **not** hardcode one. Lovable's MCP uses **Dynamic Client Registration (DCR)** per the MCP auth spec. Your bridge should:
  1. `POST` to the discovered `registration_endpoint` with your `redirect_uris`, `client_name`, `token_endpoint_auth_method: "none"`, `grant_types: ["authorization_code","refresh_token"]`, `response_types: ["code"]`.
  2. Persist the returned `client_id` (and rotate on 401).
- **PKCE** — **required** (`S256`). Public client, no client secret.
- **Scopes** — take from `scopes_supported` in the discovered metadata; MCP usually needs none beyond default identity scopes.
- **Redirect URI** — anything you register in the DCR request. For a headless VPS bridge use a loopback (`http://127.0.0.1:<port>/callback`) or a stable HTTPS URL you control. Must match exactly on the callback.

If DCR is not available on your bridge, the fallback is a Client ID Metadata Document (CIMD) hosted on your side and referenced as `client_id`. This is a Lovable-operated server, so I can't pre-register a static client for you here.

**Human enablement precondition:** the Lovable account whose projects the bridge will edit must have `Settings → Privacy & security → Third-party MCP clients` enabled (Free/Pro/Business: on by default; Enterprise: admin must enable). The OAuth flow will surface Lovable's own consent screen where that user picks which projects the bridge can act on.

---

## B. This app's own MCP server (`https://zooga-brain-hub.lovable.app/mcp`)

Concrete values (Supabase-backed):

| Field | Value |
|---|---|
| MCP endpoint | `https://zooga-brain-hub.lovable.app/mcp` |
| Protected-resource metadata | `https://zooga-brain-hub.lovable.app/.well-known/oauth-protected-resource` |
| Issuer | `https://ugcvfgzoijstdgiyttgk.supabase.co/auth/v1` |
| Discovery (RFC 8414) | `https://ugcvfgzoijstdgiyttgk.supabase.co/auth/v1/.well-known/oauth-authorization-server` |
| OIDC discovery | `https://ugcvfgzoijstdgiyttgk.supabase.co/auth/v1/.well-known/openid-configuration` |
| Authorization endpoint | `https://ugcvfgzoijstdgiyttgk.supabase.co/auth/v1/oauth/authorize` (confirm via discovery) |
| Token endpoint | `https://ugcvfgzoijstdgiyttgk.supabase.co/auth/v1/oauth/token` (confirm via discovery) |
| JWKS | from `jwks_uri` in discovery |
| Dynamic client registration | **Enabled** — `registration_endpoint` in discovery |
| Client ID | Register dynamically via DCR — no pre-provisioned static client |
| Client secret | None (public client) |
| PKCE | **Required**, `S256` |
| Scopes | `openid email profile` (identity only; app permissions come from RLS + audience `authenticated`) |
| Token audience | `authenticated` (verified by `/mcp`) |
| Redirect URI | Any HTTPS or loopback URL you register in DCR. Must appear in the registered `redirect_uris` **and** the project's redirect allow-list — send me the exact URL(s) if you want them added. |
| Consent screen | `https://zooga-brain-hub.lovable.app/.lovable/oauth/consent` (Hebrew, app-owned) |
| Signing | ES256 (asymmetric) — already migrated |

Flow the bridge implements: DCR → `authorization_endpoint` with PKCE + `redirect_uri` + `state` → user lands on Zooga consent → callback with `code` → exchange at `token_endpoint` with `code_verifier` → send `Authorization: Bearer <access_token>` on every `/mcp` call → refresh with `refresh_token`.

Bridge user must have a Zooga account in this project's Supabase (that's what "signed-in user" means for the RLS-scoped tools).

---

## What I'll do next

Nothing without your confirmation. Reply with one of:
- **"Lovable MCP"** — I'll write up exact bridge-side pseudocode against the discovery chain (I still can't invent Lovable-side values — only Lovable can).
- **"This app's MCP"** — send me the exact redirect URI(s) your VPS bridge will use and I'll add them to the Supabase redirect allow-list and confirm end-to-end.
- **"Both"** — I'll do both.
