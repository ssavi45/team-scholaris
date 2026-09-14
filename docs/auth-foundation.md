# AUTH-01 local development

## Current state

Docker Desktop and the local Supabase stack are running. Email/password registration, required email verification, resend verification, login, session persistence/refresh, logout, password recovery, and PKCE callbacks are connected. User profiles are created by a database trigger and protected by RLS.

Google OAuth is wired but disabled until provider credentials are configured. AUTH-01 still needs Google end-to-end verification and interactive browser acceptance checks. PROJECT-01 subsequently connected the dashboard and project routes; see [the project guide](project-01.md). INVITE-01 adds invitations and shared team access; see [the invitation guide](invite-01.md).

## Start development

From the repository root with Docker Desktop running:

```powershell
npx --no-install supabase start
npm run dev
```

- Application: http://127.0.0.1:5173
- Supabase Studio: http://127.0.0.1:54323
- Local email inbox (Mailpit): http://127.0.0.1:54324
- Supabase API: http://127.0.0.1:54321

Vite uses port 5173 with strictPort enabled so auth redirects cannot silently switch ports. Use the same frontend origin and browser throughout a signup/recovery flow. PKCE links need the verifier stored in the browser that requested them. Local email is captured in Mailpit, not delivered to a real mailbox.

An ignored `.env.local` was created with only the local API URL, public publishable key, and `VITE_GOOGLE_AUTH_ENABLED=false`. On a fresh checkout, copy `.env.example` to `.env.local` and copy the public key shown by `npx --no-install supabase status`. That command also displays server credentials: do not copy them into the frontend.

`VITE_SUPABASE_PUBLISHABLE_KEY` accepts either a publishable key or a legacy JWT with declared role exactly `anon`, for hosted or local development. Validation rejects secret keys, service-role/user JWTs, and malformed credentials. It does not cryptographically verify JWT signatures. Never put privileged keys or signing secrets in any `VITE_` variable; these variables are exposed by Vite.

Local Supabase settings now require email confirmation, use an 8-character password minimum, allow the frontend callback URL, and have no seed-file reference. Optional analytics was disabled after its Logflare container failed startup health checks; database/auth/mail services work without it. No database reset was performed.

## Database and authorization

`supabase/migrations/20260907000100_profiles.sql` creates:

- `profiles`: ID linked to `auth.users`, name, optional avatar URL, and timestamps.
- A signup trigger that creates each profile (also for Google signups).
- RLS allowing authenticated users to read/update only their own profile.
- Column grants restricting client updates to name/avatar, with no client insert/delete access.
- A trigger maintaining the update timestamp.

The frontend route boundary requires a session with confirmed email. It is UX protection, not database authorization. Project membership checks and project RLS must be added with the next feature before any project data is exposed.

Safe internal destinations and pending `invite` context survive auth form links and email/OAuth callbacks. Session storage is a fallback for navigation context only; it is not fake authentication. Invitation tokens are not validated or accepted in this increment. The eventual invitation backend must enforce token expiration, target email, and membership rules.

Password recovery opens `/reset-password` after a successful callback. Updating the password keeps the current authenticated session; the user can continue to the dashboard and sign out.

## Checks

```powershell
npm run lint
npm run build
git diff --check
node scripts/test-auth-navigation.mjs
node scripts/test-local-auth.mjs
```

The local integration test uses only the generated public publishable key. It refuses non-local API URLs. It creates two accounts with unique `auth-test-...` emails and random passwords; these accounts and captured emails remain for inspection. It tests signup, rejection before verification, PKCE exchange/replay rejection, invitation query retention, profile creation, cross-user/anonymous access denial, own-profile updates, session restoration/refresh, logout, incorrect passwords, and password recovery/replacement.

The navigation test checks unsafe redirects, query filtering, invitation context retention/cleanup, and operation when session storage is blocked. It uses installed TypeScript and Node; no testing dependency was added.

The production build may report a non-blocking chunk-size warning after including the Supabase SDK. Windows sandboxed Vite commands can fail with `spawn EPERM`; build succeeds with normal process permissions.

## Manual acceptance

1. Open the application and create a new account with name, email, password, and confirmation.
2. Before verifying, attempt to sign in: Supabase must reject it. Check the resend-verification action if needed.
3. Open Mailpit, find the verification email, and follow its link in the same browser/origin used for signup. The callback should open the dashboard.
4. Refresh the dashboard, then sign out. Directly visiting `/app` must return to login. Sign in again.
5. Sign out and use Forgot password. Open the newest reset email in the same browser; choose a matching new password. Continue to the workspace, sign out, and verify that only the new password works.
6. Check wrong passwords, mismatched confirmations, missing/expired callback links, keyboard navigation, and a narrow mobile viewport.
7. Open `/project/example?invite=sample-context` while signed out. Complete auth and confirm the context remains in the destination URL. Since this is not a real project ID, the project page should show Project unavailable.
8. Complete the Google checks below once credentials exist.

API checks do not substitute for these interactive UI checks. No browser was connected during the implementation run.

## Google OAuth setup (remaining)

Follow [Supabase's Google sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-google):

1. In Google Cloud, configure the consent screen and a Web application OAuth client. Add test users if the consent screen is in testing mode.
2. Add `http://localhost:5173` as an authorized JavaScript origin, and `http://127.0.0.1:54321/auth/v1/callback` as the authorized redirect URI. This is Supabase's provider callback, distinct from the frontend's `/auth/callback`.
3. Store the client ID and secret in an ignored root `.env` (without a `VITE_` prefix):

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=
```

4. Add this section to `supabase/config.toml` after the values are available:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
```

5. Restart the local stack with `npx --no-install supabase stop`, then `npx --no-install supabase start`. Do not use `--no-backup` or reset the database.
6. Set `VITE_GOOGLE_AUTH_ENABLED=true` in `.env.local`, restart Vite, and test Google login, callback, profile creation, refresh, and logout.

For a hosted project, apply the migration and configure email confirmation, site/callback URLs, and Google in that project's dashboard. Use its public credentials in `.env.local`. Hosted configuration and deployment were not performed.

## Changed files for the connected-auth increment

Created: `AuthProvider.tsx`, `auth-context.ts`, `auth-navigation.ts`, `ResetPasswordPage.tsx` under `src/features/auth/`; the profiles migration; `scripts/test-local-auth.mjs`; `scripts/test-auth-navigation.mjs`; ignored `.env.local`.

Updated: `src/App.tsx`, `src/app/router.tsx`, `src/components/layout/AppShell.tsx`, `src/features/auth/{AuthPage,AuthCallbackPage,ProtectedRoute}.tsx`, `src/lib/supabase.ts`, `src/index.css`, `supabase/config.toml`, `vite.config.ts`, `.env.example`, `README.md`, and this guide. No packages were installed.

PROJECT-01 now delivers dashboard data and create/open project with database-enforced ownership and limits. INVITE-01 adds invitations and shared team access; see [the invitation guide](invite-01.md).
