# Build tracker

Last updated: 2026-09-27. This root `task.md` is the only build task file.
Update it for each next authorized build; preserve delivered history in
[docs/MEMORY.md](docs/MEMORY.md) and durable decisions in
[docs/DECISIONS.md](docs/DECISIONS.md). Do not create TASKS.md or per-build trackers.

SETTINGS-01 is implemented locally. The scope below records the delivered
contract; manual workflow acceptance is still pending with the user.
Google Calendar/Meet work remains paused and is not a prerequisite for Settings.

## Follow-up: supplied branding

- [x] Connect the PNG favicon and shared wordmark on navbar, Paper header and auth pages.
- [x] Preserve the original assets; use responsive CSS framing for mockup margins.
- [x] Run lint, production build and diff whitespace checks (all passed).

Interactive visual acceptance remains with the user.

Favicon visibility follow-up: replaced the linked favicon with a tightly framed
`public/team-scholaris-favicon-v2.png`, preserving the original. Built-in image
editor prompt: enlarge the existing white book-and-leaves emblem, remove outer
white margins, and use an opaque forest-green background with a small inset.

## Implementation checklist

- [x] Inspect current SQL, lock order, grants, frontend API contracts and local changes.
- [x] Add settings revision and narrow owner-authorized management/recovery RPCs.
- [x] Enforce quota-safe creation/transfer/restore concurrency and retry receipts.
- [x] Add Settings route in the shared shell, read-only summary and General form.
- [x] Add archive/unarchive with cross-feature read-only enforcement.
- [x] Add eligible-member ownership transfer and role/invitation transitions.
- [x] Add confirmed soft deletion and owner-only Dashboard Trash.
- [x] Add server-authorized recovery window and restore into archived state.
- [x] Integrate Activity, dependent-view refresh and stale-access handling.
- [x] Review keyboard/mobile, drafts, error/retry and conflict handling in code; browser acceptance remains below.
- [x] Run authorized static checks and record results; user performs workflow acceptance.
- [ ] Complete the manual acceptance matrix below and record unresolved issues.
- [x] Update canonical docs and MEMORY with actual delivered/accepted status.

Verification record: the local migration `20260926000100_project_settings.sql`
was applied successfully without resetting existing data. `npm run lint` and
`npm run build`, `git diff --check`, documentation links and new-file whitespace
checks passed.
No workflow fixtures, real transfers/deletions, Google calls or hosted
deployment were performed. Manual acceptance remains pending.

## Current build: SETTINGS-01 - Project settings and recovery

Status: implemented locally; awaiting manual acceptance. Google Meet integration
remains paused at the user's request.

## Outcome

Project owners can edit project details, archive/unarchive, transfer ownership,
and move a project to recoverable Trash. Team members can see current settings
without gaining management permissions. Paper retains its independent layout.

## Existing foundations

- `projects` already has name, description, owner_id, status, and deleted_at.
- Name limit: 120 characters; description: 5,000 characters.
- Owner integrity uses a unique owner-membership index and deferred checks.
- `max_owned_projects()` currently returns five. Archived owned projects count;
  joined and soft-deleted projects do not. Creation already uses an advisory lock.
- Activity already recognizes details/lifecycle/ownership events. Reuse those
  triggers rather than generating duplicate events in the browser.
- Ordinary project reads exclude soft-deleted projects. Trash therefore needs
  a separate, narrow owner-only read path; do not weaken existing access rules.
- Frontend `PROJECT_RECOVERY_DAYS` is 30; the backend now enforces the matching
  window through `project_recovery_days()` and restore eligibility checks.

## User-facing scope

| Surface | Behavior |
| --- | --- |
| Settings tab | `/project/:projectId/settings`, inside ProjectTabShell, after Meetings and before Tasks |
| General | Edit name/description; display project ID, creation date, current owner, and status |
| Lifecycle | Archive an active project; unarchive a retained archived project |
| Ownership | Transfer an active project to an eligible current member with a dedicated confirmation |
| Danger zone | Move an active or archived project to Trash using typed-name confirmation |
| Dashboard Trash | Owner-only deleted-project cards, deletion/recovery dates, and Restore action |

Use a responsive settings form and a compact status/ownership sidebar. Keep
dangerous actions visually separated. On small screens, stack sections in the
same order. Show success near the action, field-specific validation, loading,
empty/error/retry states, and clear read-only explanations. Use native accessible
dialogs, named controls, keyboard focus restoration, and unsaved-edit guards.

### General details

Only the current verified owner of an active project can save. Trim names and
reject whitespace-only names; use the existing length limits. Save explicitly;
preserve drafts on network/conflict errors. Avoid changing updated_at or creating
history for a no-op save. Members and viewers see a read-only summary.

### Archive and unarchive

Archive confirmation explains that all retained research remains readable but
editing stops. Archive does not free an ownership slot. Team members may still
leave using the existing Team action. Pending invitations cannot be accepted
while archived; ordinary expiry still applies.

For an archived project, Settings offers owner-only Unarchive and Move to Trash;
details/transfer stay disabled until unarchived. Existing team, paper, files,
chat, tasks, and meeting content must remain intact across both transitions.

### Ownership transfer

- Active projects only. Select another current, verified `member`; viewers must
  first be promoted through Team. Never transfer to an outsider or to yourself.
- Show the recipient, the ownership-limit rule, and the resulting roles. Require
  typed project name and an explicit acknowledgement that management moves to
  the recipient. Transfer is immediate; acceptance/invitation workflow is outside
  this increment.
- In one transaction, change projects.owner_id, demote the old owner to member,
  and promote the recipient to owner. Preserve descriptive research roles and
  all historical contribution attribution.
- Enforce the recipient's current non-deleted owned-project quota server-side,
  including simultaneous create/restore/transfer requests.
- Revoke outstanding invitations from the previous ownership period. They must
  not become valid again if ownership later transfers back.
- Refresh Dashboard, Team, Settings, and Overview; remove the old owner's edit
  controls immediately after success. Old-owner stale tabs must fail server-side.

### Trash and restore

- Soft-delete only: retain research rows, storage objects, membership, and
  history. Revoke pending invitations; hide the project from normal dashboards
  and deny subsequent project reads/writes through existing access checks.
- Return the owner to Dashboard after deletion with a link to Trash. Other
  teammates cannot list the deleted project or its contents through Trash.
- Owner-only Trash RPC exposes only the metadata needed for recovery. Paginate
  retained records and distinguish recoverable from expired entries.
- Establish a server-authoritative 30-day recovery window, matching the existing
  UX constant. Return recover_until and restore eligibility from the server;
  never trust the browser clock to authorize restoration.
- Restore only if the caller still owns the record, the recovery window is open,
  and an ownership slot is available. Restore into **archived/read-only** state
  with an explicit confirmation explaining that retained team access returns.
  Owner can review the team before unarchiving.
- Preserve membership and research content; revoked invitations stay revoked.
- No permanent-delete button or automatic purge job in this build. After 30 days
  self-service restore expires; do not claim retained database/storage data has
  been physically erased. Storage quotas continue to account for retained data
  where applicable. Purge/retention enforcement needs a separate design.

## Permissions

| Action | Active owner | Member/viewer | Archived owner |
| --- | --- | --- | --- |
| Read settings | Yes | Yes | Yes |
| Edit details | Yes | No | No |
| Transfer ownership | Yes | No | No |
| Archive | Yes | No | Already archived |
| Unarchive | Already active | No | Yes |
| Move to Trash | Yes | No | Yes |
| List/restore Trash | Current owner only, subject to recovery window and quota | No | Same owner rules |

Verified authentication is required for all management mutations. Anonymous,
outsider, departed-member, stale-owner, and direct-table-write attempts are denied.

## Backend and frontend structure

Delivered feature files:

- `src/features/settings/SettingsPage.tsx`
- `src/features/settings/settings-api.ts`
- `src/features/settings/settings-types.ts`
- `src/features/settings/SettingsActionDialog.tsx`: lifecycle/transfer/recovery confirmations.
- `src/features/settings/ProjectTrash.tsx`: Dashboard Trash backed by the recovery RPC.
- `src/features/settings/useSettingsGuard.ts`: navigation, unload and sign-out guards.

Add project `settings_revision` for compare-and-swap mutation checks; do not use
updated_at as a settings revision because team actions also update it. Ensure a
single server-side mechanism advances that revision for managed fields even
when another trusted path changes them.

Delivered narrowly scoped RPCs (every mutation also takes `operation_id`; the
Trash list is read-only):

1. `update_project_details(project_id, expected_revision, name, description)`
2. `set_project_archived(project_id, expected_revision, archived)`
3. `transfer_project_ownership(project_id, expected_revision, recipient_id)`
4. `trash_project(project_id, expected_revision)`
5. `list_deleted_owned_projects(cursor, limit)`
6. `restore_project(project_id, expected_revision)`

Keep browser SELECT-only grants on projects and project_members. Mutations use fixed-search-path functions
with explicit role grants, input validation, current-owner checks, and atomic
changes. Use stable operation IDs for mutation retries, especially transfer:
after success the original caller is no longer owner, so a lost response must be
reconciled without performing a second transfer or issuing misleading denial.
Scope receipts to their authenticated caller, action, project, and input payload.

Implemented lock order: caller/operation lock, then distinct per-user quota keys
in sorted key order, then project row. Quota keys reuse the exact convention in
create_project. Ownership, revision and recipient membership are checked after
acquiring locks. Existing team/content operations never acquire quota locks after
their project-row lock. Receipts store a SHA-256 request digest and minimal result;
they are private to trusted functions. The fixed-action wrappers call an internal
helper with no browser execution grant. Unconfirmed browser requests keep their
original payload/operation ID and offer a safe same-request retry.

Refresh dependent views after success and on focus. Preserve unsaved forms rather
than replacing their data on focus. Treat unavailable access separately from
network errors. Clear cached project details when deletion/revocation is detected.

## Cross-feature behavior

- Reuse existing project Activity triggers for changes; retain lifecycle history
  so it becomes visible after restoration. Team transfer events may accompany
  the project ownership event, but do not duplicate either from client code.
- Audit paper/file Storage authorization as well as ordinary database RLS for
  archive/deletion. Already downloaded content cannot be recalled; existing signed
  links can remain valid until expiry. Do not promise immediate revocation of
  externally held links or copies.
- Archive/delete/transfer do not cancel Google events, end Meet calls, revoke
  Google access, or repair the paused integration. Explain this in confirmations
  when Google-linked meetings exist. Calendar ownership remains with its organizer.
- Google operations already in progress may finish externally during a lifecycle
  change; retain the existing reconciliation/error state and do not auto-retry
  against an archived/deleted project.

## Build order and acceptance

1. Database management/recovery RPCs, locking, revisions, and permission rules.
2. Settings route/shell, General form, archive/unarchive.
3. Ownership transfer and danger-zone confirmations.
4. Dashboard Trash and restoration, with quota/recovery feedback.
5. Activity/cache integration and cross-feature permission review.
6. Lint, frontend build, and whitespace checks; manual acceptance by the user.

Manual checks: owner versus member/viewer; archive read-only enforcement across
all tabs; simultaneous stale edits; network retries; transfer at recipient quota;
transfer versus project creation; deletion from two tabs; hidden/deleted direct
URLs and Storage reads; owner-only Trash; restore at quota; expired recovery;
preserved research and memberships; revoked invitations after transfer/restore;
mobile layout and keyboard/dialog behavior. Runtime workflow checks are left to
the user; static checks do not mark this acceptance complete.

## Manual acceptance record — pending

| Scenario | Expected result | Status |
| --- | --- | --- |
| Owner edits name/description; no-op save | Saved across reload; no duplicate history or revision for unchanged details | Pending |
| Member/viewer and outsider requests | Read-only for teammates; management denied server-side; outsider reads denied | Pending |
| Archive and unarchive across every tab | Retained reads, denied writes/invite acceptance while archived; data preserved | Pending |
| Two stale Settings forms | Losing save retains draft and reports conflict | Pending |
| Transfer with concurrent create/restore and full recipient quota | Exactly one owner; quota never exceeded; old owner becomes member | Pending |
| Lost response then retry same operation | One change/event; completed transfer/delete can be reconciled by original caller | Pending |
| Trash from two tabs and direct URLs/Storage | Normal access denied; only owner sees minimal Trash metadata | Pending |
| Restore within window, at quota, after expiry | Server enforces eligibility; eligible restore is archived with retained team/content | Pending |
| Pending invitations after transfer/Trash/restore | Revoked invitations never regain validity | Pending |
| Mobile, keyboard, dialog cancellation, reload/sign-out with drafts | Usable layout, focus restoration and unsaved-change guards | Pending |

Done means the full lifecycle works without manual SQL, every management action
is enforced server-side, and users can recover eligible projects through the UI.
Exclude account-wide preferences, billing, project templates, public sharing,
permanent purge, Google Meet fixes, and collaborative paper editing from SETTINGS-01.
