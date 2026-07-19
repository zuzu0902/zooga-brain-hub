# Enable Agent Integrations (Protected OAuth) — verification + minimal tool set

## Current state (verified)

- MCP server already wired at `/mcp` with Supabase OAuth 2.1 (`auth.oauth.issuer`, audience `authenticated`) — no public/no-auth path.
- `supabase--configure_oauth_server` already active: DCR enabled, consent path `/.lovable/oauth/consent`, Site URL + redirect allow-list correct, no MCP config issues reported.
- Hebrew consent screen exists at `src/routes/[.]lovable.oauth.consent.tsx`.
- Manifest `.lovable/mcp/manifest.json` up-to-date with 5 tools.

So OAuth-only mode is already what's shipped — no code changes needed to enforce it.

## What this plan does

1. Run `supabase--migrate_signing_keys` to ensure the project uses asymmetric (ES256) JWT signing keys. MCP OAuth ID token signing fails on legacy HS256 with "HS256 is not supported for ID token signing"; the tool is idempotent and a no-op if already ES256.
2. Re-run `app_mcp_server--extract_mcp_manifest` to confirm the manifest still builds cleanly against the current entry.
3. Keep the current small, trip-sales-focused tool set as the "first tool set":
   - `list_contacts` (read)
   - `get_contact` (read)
   - `list_offers` (read)
   - `list_tasks` (read)
   - `create_task` (write, non-destructive)

No new tools, no removed tools, no schema changes. All tools already scope to the signed-in user via `requireSupabaseAuth`-equivalent bearer forwarding + RLS.

## Not doing

- Not adding a public/no-auth MCP path — user explicitly asked OAuth-only.
- Not changing consent UI, redirect allow-list, or Site URL — debug tool reports clean.
- Not touching Railway bridge endpoints.

## After apply

User enables the server from More → Agent integrations; connecting clients (Claude/ChatGPT/Cursor) go through the Hebrew consent page and receive user-scoped tokens.
