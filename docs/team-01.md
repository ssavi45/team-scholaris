# TEAM-01: project team management

Open a project and choose **Team**. This tab uses `ProjectTabShell`, alongside
Overview, Files, and Chat. Paper retains its independent full-width workspace.
The Overview links to Team; Chat's invitation shortcuts open Team too.

## Behavior

- Everyone on the project can see names, access levels, and optional research roles.
- Owners of active projects can invite/revoke invitations, edit member/viewer
  access, set research roles, and remove teammates with confirmation.
- The owner's research role can be edited, but owner access cannot be assigned,
  demoted, removed, or abandoned through these controls.
- Members and viewers can leave, including from an archived project. A new
  invitation is required to return. Accepted invitations cannot restore access.
- Archived projects allow team reads and self-departure; owner edits, removal,
  and invitations remain disabled.
- Removal/departure preserves paper content, messages, uploads, and attribution.
  A research-role label never changes permissions.
- Refresh reloads membership and invitation state. Returning to the Team browser
  window refreshes access unless a confirmation dialog is open. Dialogs retain
  errors and prevent duplicate submission; destructive actions require confirmation.

## Database

`20260919000300_team_management.sql` adds `update_project_member`,
`remove_project_member`, and `leave_project`. All require a currently verified
caller and lock the project before mutations, matching invitation lock order.
Direct membership writes remain unavailable to frontend clients. Updates compare
the displayed access/role snapshot with current values; stale edits/removals fail
instead of overwriting another change. The existing deferred owner constraint
remains in force. Pending invitations for a departing member are revoked.

Existing RLS and storage policies evaluate current membership on each request.
Demotion blocks subsequent writes from existing sessions; removal blocks new
reads/downloads as well. Previously downloaded content cannot be recalled.

The migration has been applied to the **local** stack. Hosted Supabase has not
been changed by this build. No privileged credentials enter the frontend.

## Local verification

With the local Supabase stack running and `.env.local` pointing to it:

```powershell
npx --no-install supabase migration up --local
# Keep the invitation function running for local Mailpit delivery:
npx --no-install supabase functions serve send-project-invitation --env-file supabase/functions/.env.local
```

In another terminal:

```powershell
node scripts/test-local-team.mjs
node scripts/test-local-invitations.mjs
npm run lint
npm run build
git diff --check
```

The Team integration test creates isolated local accounts and uses browser-safe
public credentials for RPCs, storage, and data access. It covers owner/member/
viewer/outsider/anonymous checks, verification, owner protection, concurrent and
stale edits, actual Paper/Files/Chat access after demotion/removal, preserved
contributions, archive rules, leaving, and fresh versus already-used invitations.
Fixture users, project, and uploaded object are removed afterward.

Manual UI acceptance: use an owner and a member in separate browser profiles;
open Team, edit the member to Viewer, refresh their workspace, and confirm write
controls disappear. Try removal and self-leave, then confirm their dashboard no
longer lists the project. Check dialogs with keyboard navigation and the Team tab
on a narrow screen. Interactive browser verification was unavailable during this
build because the browser tool had no connected browser.

Settings, ownership transfer, project lifecycle controls, meetings, and tasks
are separate increments; see [the next-build plan](next-build.md).
