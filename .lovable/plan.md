## Problem

After Google sign-in returns to the app, the user lands back on `/login` instead of `/`. The cause is a race between the OAuth flow and the auth context:

1. `lovable.auth.signInWithOAuth("google")` calls `supabase.auth.setSession(tokens)` and returns.
2. `login.tsx` then calls `navigate({ to: "/" })` via the router.
3. `/` mounts `_app.tsx`, which reads `user` from `AuthProvider`. At that moment the initial `getSession()` has already resolved with `null` (so `loading=false`), and the `onAuthStateChange` event from `setSession` hasn't propagated yet → `user` is still `null` → `_app.tsx` redirects back to `/login`.

This is a client-side state-timing bug, not an OAuth/preview-vs-published config issue (Google logins to production already succeed in auth logs).

## Fix

Replace the router navigation in `handleGoogle` (and `handleLogin`) with a full-page reload to `/`. A full reload re-creates `AuthProvider`, whose `getSession()` reads the freshly-persisted session from `localStorage` synchronously on mount, eliminating the race.

### Files to change

**`src/routes/login.tsx`** — in both `handleGoogle` and `handleLogin` success paths, replace:

```ts
navigate({ to: "/" });
```

with:

```ts
window.location.href = "/";
```

That's the only change. No backend, RLS, middleware, or routing-architecture work needed.

## Why not a route guard refactor

The proper long-term fix would be migrating `_app.tsx` to a `beforeLoad` gate with `context.auth` (per `tanstack-auth-guards`). That's a larger refactor of the auth context plumbing and out of scope for this single bug. The hard reload is a 2-line fix that resolves the user-reported symptom immediately and is safe to keep.

## Verification

1. Open `/login`, click "המשך עם Google", sign in with `alexz@segapo.com`.
2. Browser redirects to `/` and stays there.
3. The 7 contacts appear (admin role already granted by `handle_first_user` trigger).
