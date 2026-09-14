# PROJECT-01: create and open projects

## Delivered behavior

The dashboard queries real Supabase data, separating projects you own from projects you have joined. New project opens a native modal with name (required, maximum 120 characters) and description (optional, maximum 5000 characters). Creation opens the overview; returning to the dashboard or refreshing reads persisted data.

The overview shows name, description, status, your access level, team size, and creation/update dates. Missing, deleted, malformed, and unauthorized project IDs have the same unavailable presentation. Failed requests offer retry. No project editing, deletion, archiving controls, invitation acceptance, or other product features are included.

## Database enforcement

`20260912000100_projects.sql` adds `projects` and `project_members`, with RLS on both. Authenticated clients have SELECT only. They cannot insert projects directly, join themselves, edit membership, spoof ownership, or delete records.

`create_project` is the only client creation path. It requires verified authentication, validates input, derives ownership from `auth.uid()`, and creates the project plus owner membership atomically. A deferred constraint trigger and unique index require exactly one matching owner membership.

The backend limit is defined by `max_owned_projects()` (5); keep `src/lib/constants.ts` aligned if changing it. A transaction-scoped per-user advisory lock serializes creation to enforce the quota under concurrent requests. All non-deleted owned projects count, including archived projects. Joined projects do not count. Future restore/transfer operations must enforce the same ownership limit.

`can_access_project` checks only the caller's membership and excludes soft-deleted projects. Its fixed search path and security-definer execution avoid recursive membership RLS. Members/viewers can read their projects and membership records. Display roles grant no permissions. Profile RLS remains private; project pages do not expose unrelated profiles.

## Test commands

```powershell
npm run lint
npm run build
git diff --check
node scripts/test-auth-navigation.mjs
node scripts/test-local-projects.mjs
```

The project integration test is restricted to the local API. It signs up three temporary accounts with random passwords, uses Docker/SQL only for controlled verification and membership fixtures, and exercises application calls using public credentials. It cleans up only its own projects and accounts. Mailpit may retain their captured signup emails.

Coverage: validation, atomic ownership, RLS denial for anonymous/nonmembers, direct-write bypass attempts, owner integrity, member/viewer reads, display-role separation, joined versus owned counting, archived/deleted visibility, and eight concurrent create requests competing for four available slots.

## Manual acceptance

1. Start the frontend with `npm run dev`; open http://127.0.0.1:5173 and sign in.
2. Click New project, supply a name and description, and create it. Confirm the overview shows owner access and a team size of one.
3. Return to the dashboard. Confirm the project is under Owned projects; refresh and reopen it.
4. Try blank/whitespace names, long input, Cancel, Escape, Tab/Shift+Tab, and a narrow mobile viewport. Submission errors must retain entered values.
5. In a separate browser session, sign in as another user and open the first project's URL. Confirm Project unavailable and no project details. Confirm the project is absent from that user's dashboard.
6. Create five owned projects. Confirm the New project control is disabled and explains the limit. The integration test separately checks direct API and concurrent quota bypasses.
7. Test an invalid UUID and an unknown UUID; both should show Project unavailable. Stop/restart the local backend to check retry behavior without resetting data.

INVITE-01 now implements joining through invitations; see [the invitation guide](invite-01.md). The PROJECT-01 test still uses explicit member/viewer fixtures to validate read behavior. Do not create ad hoc membership from frontend code.

## Environment and remaining setup

The default frontend still uses local Supabase from ignored `.env.local`, preserving existing local accounts. The CLI is linked to hosted Team Scholaris (`pnkzzpjdezmrrcepcstv`). Both the profiles and project migrations were applied there after a dry run. Cloud auth redirects/email/OAuth and frontend environment switching remain a separate setup step; local accounts do not migrate automatically. Never run the local fixture test against a hosted project.

Google OAuth and full hosted AUTH-01 acceptance are still pending. No browser connection was available for PROJECT-01, so interactive project acceptance should be checked using the steps above.

## Verification results

Local project security/concurrency tests and auth navigation checks passed. Lint and production build passed; build retains the existing non-blocking bundle-size warning. `git diff --check` passed. Testing caught a shared-trigger field-reference error; the unpublished migration and its local function were corrected before deploying to hosted Supabase, and security tests then passed. No database reset or Git push was performed.

## File inventory

Created: the project migration, `projects-api.ts`, `CreateProjectDialog.tsx`, `scripts/test-local-projects.mjs`, and this guide.

Updated: `DashboardPage.tsx`, `ProjectPage.tsx`, `src/index.css`, `README.md`, and the auth guide's project-status notes. Existing auth work was preserved. No dependencies were added.
