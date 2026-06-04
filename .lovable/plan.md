## Problem

The app does not load at all. Dev server logs show repeated:

```
ReferenceError: require is not defined
    at eval (/dev-server/src/server.ts:1:9)
```

Root cause: `src/server.ts` has been overwritten with the **Railway Tamar runtime code** (an Express + CommonJS `require("dotenv")…` server, 801 lines) instead of the TanStack Start Worker entry wrapper. TanStack Start expects `src/server.ts` to export a `fetch` handler that lazily imports `@tanstack/react-start/server-entry`. Because the file uses `require(...)` in an ESM/Worker context, every SSR request crashes before any route renders — the whole preview is dead.

This is unrelated to Tamar features themselves; Railway runtime code belongs on the Railway side, not in the Zooga Lovable project's server entry.

## Fix

Restore `src/server.ts` to the canonical TanStack Start wrapper (lazy import + try/catch + h3-500 response normalizer + global error capture), per the project's SSR error-handling pattern. `src/lib/error-capture.ts` and `src/lib/error-page.ts` already exist in the project and will be reused.

### Steps

1. Replace `src/server.ts` entirely with the canonical wrapper:
   - side-effect import of `./lib/error-capture`
   - `getServerEntry()` lazily imports `@tanstack/react-start/server-entry`
   - `normalizeCatastrophicSsrResponse()` converts h3-swallowed 500s into branded HTML
   - default export `{ fetch }` with try/catch
2. Do NOT touch any Tamar feature files (`src/routes/api/public/webhook/tamar.ts`, `runtime/tamar-pack.ts`, `lib/tamar-runtime-composition.ts`, settings pages). Those are fine; only the server entry is wrong.
3. After the patch, confirm Vite dev server logs no longer show `require is not defined` and the preview renders.

### Files changed

- `src/server.ts` — full rewrite back to TanStack Start wrapper (the Railway/Express code is removed from this repo entirely).

### Out of scope

- Railway-side Tamar runtime. If that Express code needs to live somewhere, it belongs in the Railway repo, not in `src/server.ts` here.
- Any further Tamar behavior/observability changes (those still work once SSR is restored).
