## Why you can't see the token

Lovable's secret store is one-way: once a value is saved (whether you typed it, or I generated it), the UI and tools can only show the **name**, never the value. Deleting and re-adding doesn't change that — if the recreate flow didn't show you the value at the moment of creation, it's no longer retrievable from Lovable.

`generate_secret` (what I used originally) writes a random value straight to the vault without ever surfacing it in chat, which is why you never saw it. That was the wrong tool for a token you also need to paste into Railway.

## Fix: you choose the value, you keep the copy

1. Delete the current `RUNTIME_BRIDGE_TOKEN` from the vault (it's unknown to both of us, so it's useless).
2. Generate a strong token on your side — e.g. run `openssl rand -hex 32` locally, or use any password manager's generator (32+ chars, alphanumeric).
3. I trigger the Lovable "add secret" prompt for `RUNTIME_BRIDGE_TOKEN`. You paste your token into the secure form. Because you generated it, you already have the plaintext to paste into Railway too.
4. Paste the same value into Railway as `LOVABLE_BRIDGE_TOKEN` (or whatever the Railway side calls it). Railway sends it as `Authorization: Bearer <token>` to `/api/public/runtime/lead-context`, `/writeback`, `/handoff`.
5. Verify with a quick curl from your machine:
   ```
   curl -H "Authorization: Bearer <token>" \
     "https://zooga-brain-hub.lovable.app/api/public/runtime/lead-context?phone=+972500000000"
   ```
   200 with JSON = wired correctly. 401 = token mismatch.

## Fallback already in place

The bridge auth helper also accepts `api_settings.webhook_token`. If Railway is already configured with that token, the endpoints will authorize today without any new secret — useful as a stopgap if you want to unblock Railway before doing the steps above.

## No code changes

This is purely a secret-rotation flow. No files in the repo change.