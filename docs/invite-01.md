# INVITE-01: invitations and shared project access

The dedicated **Team** tab now contains invitations and member management.
See [TEAM-01](team-01.md) for current behavior; the notes below describe the
original invitation increment.

## Delivered

Owners of active projects can invite an email as member or viewer from the project Team section. Email addresses are trimmed and lowercased. Invitations expire after seven days. Sending another invitation to the same email replaces the prior unaccepted link; owners can revoke pending invitations. Existing members cannot be reinvited or have their access silently changed.

The recipient can sign up or log in, verify their email, and explicitly accept from the dashboard. Projects then appear under Joined projects. The overview displays the shared team, with names and descriptive roles, while unrelated profiles remain private. Refresh team refreshes the overview and member count. No membership removal, role editing, ownership transfer, chat, files, or paper editor was added.

## Local setup

Use three terminals from the repository root:

```powershell
# Start Docker Desktop first. This returns after services are ready.
npx --no-install supabase start

# Keep this command running in its own terminal.
npx --no-install supabase functions serve send-project-invitation --env-file supabase/functions/.env.local

# Keep the frontend running in another terminal.
npm run dev -- --host 127.0.0.1
```

The ignored `supabase/functions/.env.local` is configured for Mailpit; its tracked `.env.example` documents those values. The local application origin is http://127.0.0.1:5173. Use that exact origin for the invitation form because the function restricts browser origins. Emails appear at http://127.0.0.1:54324; they are captured locally, not sent to real inboxes.

## Acceptance test with two browsers

1. Sign in as User A, open your project, and find Team / Invite a teammate.
2. Enter User B's email and select Member or Viewer. Send the invitation. Confirm the success message and pending entry. Wait at least one minute before resending the same email.
3. Open Mailpit and find the Team Scholaris invitation. Copy its link into a different browser/profile where User A is not signed in. Use the same local application origin.
4. Sign in as B or create B's account with the invited email. If signing up, open the account-verification email in that same browser/profile so PKCE verification succeeds. Return to the invitation link if necessary; B's dashboard also lists the pending invitation without the link.
5. Click Accept invitation. Confirm the project opens with the assigned access, appears in Joined projects, and remains after refresh.
6. Back as A, Refresh team. Confirm B appears and the team count increases.
7. Try the invitation as an unrelated verified User C. No invitation/project details should appear, and acceptance must fail.
8. Invite another email, revoke it as A, then try its old link. Also check an invalid token and an expired invitation. None may grant membership.

For archived projects, reading remains available but inviting, revoking, and accepting are denied. Returning members do not gain different permissions from descriptive roles.

## Security and token behavior

`20260912000200_invitations.sql` creates a private RLS-enabled invitations table with no client table privileges. Only narrow RPCs expose metadata. The database generates a 256-bit random token and stores its SHA-256 hash. The email function does not return the token to the browser or log it. Owners can create tokens through the owner-checked RPC, but cannot read token hashes from the table.

Email-link acceptance validates the supplied token hash, expiry, revocation, active project, current owner, and the caller's current verified email from `auth.users`. Opening an email does not accept automatically. Dashboard acceptance can use an invitation ID without the email token because the server independently requires the authenticated, verified target email. Knowing an invitation ID or token alone never grants access.

Project/row locks serialize creation, acceptance, and revocation. Repeat acceptance by the same member is idempotent; it does not duplicate or promote membership. Accepted invitations cannot be reused to rejoin after removal. Old-owner invitations become unusable after ownership changes. Owner creation is limited to 20 invitations per project per hour and one per recipient per minute, enforced in PostgreSQL even for direct RPC calls. The backend expiry is defined by `invite_expiry_days()`; keep the frontend `INVITE_EXPIRY_DAYS` aligned if changing it.

The Edge Function runs RPCs as the caller and uses no service-role credential. `verify_jwt = false` allows both supported JWT signing formats through the legacy gateway, but the handler always validates the bearer token by calling Supabase Auth `/user` before performing any action. Browser origin checks supplement this authentication. Plain-text emails avoid injecting project names into HTML.

Delivery configuration is checked before an invitation is created. If delivery fails after creation, the handler returns HTTP 502 with an explicit message: the invitation is saved, email delivery is unconfirmed, and the recipient can accept from their dashboard. No success is shown for failed delivery. A later replacement invitation invalidates the old pending token.

## Hosted state and remaining configuration

The invitation migration and `send-project-invitation` function are deployed to hosted Team Scholaris (`pnkzzpjdezmrrcepcstv`). The default frontend still uses local Supabase. Hosted email delivery is not enabled, and hosted end-to-end acceptance has not been tested.

Before enabling hosted delivery, configure these **Edge Function secrets**, never `VITE_` variables:

```dotenv
APP_ORIGIN=https://your-frontend-origin
INVITE_EMAIL_PROVIDER=resend
RESEND_API_KEY=your-provider-key
INVITE_FROM=Team Scholaris <invitations@your-verified-domain>
```

Use your actual frontend origin and a verified sender. `APP_ORIGIN` controls both CORS and invitation link construction; request input cannot override it. Do not set Mailpit values in hosted secrets. Resend is an optional configured provider path, not a purchased service. Its delivery path requires provider credentials and has not been tested against Resend. Hosted auth redirects, auth email delivery, and Google OAuth remain separate AUTH-01 setup items.

Provider references: [Supabase function authentication](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Mailpit sending API](https://mailpit.axllent.org/docs/usage/sending-messages/).

## Verification

```powershell
npm run lint
npm run build
git diff --check
node scripts/test-auth-navigation.mjs
node scripts/test-invitation-handler.mjs
node scripts/test-local-invitations.mjs
npx --no-install tsc --ignoreConfig --noEmit --skipLibCheck --target es2023 --module esnext --lib es2023,dom supabase/functions/runtime.d.ts supabase/functions/send-project-invitation/index.ts
```

The local integration test creates temporary users/projects, sends genuine local emails, follows the new user's verification email, and verifies invitation context and acceptance. SQL is used only for controlled fixture setup and expiry/archive tests. Requests use public credentials. Fixtures are removed; captured Mailpit emails may remain. Do not run fixture tests against hosted projects.

Checks passed: Mailpit delivery, forged-session and nonowner denial, token privacy, invite-before-signup, matching-email checks, concurrent/idempotent acceptance, joined-project access, member/viewer restrictions, expired/revoked/archived rejection, dashboard acceptance, navigation preservation, and handler delivery/configuration failures. Frontend lint/build and Edge Function typechecking pass. Build retains the existing non-blocking bundle-size warning. Interactive browser acceptance remains manual when no browser is connected.

Generated `src/types/database.ts` now types the Supabase client and RPC calls. Regenerate it from the database after schema changes. No package dependencies were added.

## Files

Created: invitation migration; `supabase/functions/send-project-invitation/index.ts`; minimal runtime types; function environment example and ignored local environment; `src/features/invitations/{invitations-api,PendingInvitations,ProjectTeam}`; generated database types; two invitation test scripts; this guide.

Updated: dashboard and project overview, Supabase client typing, shared CSS, Supabase function config, README, and project/auth documentation. Existing work and local accounts were preserved. No Git commit or push was performed.
