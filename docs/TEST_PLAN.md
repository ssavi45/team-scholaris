# Test plan

## What counts as working

A feature needs persisted happy-path behavior, authorization at the backend,
recoverable failures, conflict handling, and usable keyboard/mobile states.
Compilation/lint success alone does not establish runtime acceptance. Historical
checks and user-reported acceptance are recorded in [MEMORY](MEMORY.md), not
relabelled as current results. This documentation update does not run app tests.

The user's current preference is manual workflow acceptance. For subsequent
implementation, follow the authorized build's verification scope. Run relevant
static checks and targeted automated checks when requested/appropriate; do not
run data-mutating suites or provider actions merely to update documentation.

## Standard checks

From the repository root:

```powershell
npm run lint
npm run build
git diff --check
```

Build includes TypeScript checking and Vite output. For documentation-only changes,
validate local links, filenames, consistency and whitespace instead of rerunning
unrelated feature workflows. No `npm test` script or separate test framework is
currently installed. Existing checks are Node scripts in `scripts/`.

For Edge Function changes, the frontend build is insufficient. A focused
backend TypeScript check can be run per handler, for example:

```powershell
npx --no-install tsc --ignoreConfig --noEmit --target ES2023 --module esnext --lib ES2023,DOM --skipLibCheck supabase/functions/runtime.d.ts supabase/functions/google-calendar/index.ts
```

Substitute the invitation handler path when checking that handler. These checks
do not replace running the function in its actual Supabase runtime.

## Existing automated harnesses

Run a selected harness with `node scripts/<filename>`. Inspect its prerequisites
and cleanup before execution, especially when local data matters.

| Script | Coverage / prerequisite |
| --- | --- |
| `test-auth-navigation.mjs` | Auth return paths, invitation context and browser storage failure handling; no database |
| `test-invitation-handler.mjs` | Handler authentication/origin/delivery branches with mocked dependencies |
| `test-paper-export.mjs` | Export snapshots, safe filenames, PDF/ZIP handling and cleanup |
| `test-paper-compiler.mjs` | Actual vendored WASM compiler, nested sources/main, BibTeX/references, PDF parsing, failure/cancellation; may fetch runtime TeX resources |
| `test-local-auth.mjs` | Local verification, session/profile and password flow; local Auth/Mailpit |
| `test-local-projects.mjs` | Project creation, ownership/access and concurrent quota enforcement |
| `test-local-invitations.mjs` | Local invitation email, verified acceptance, expiry/revocation and access |
| `test-local-team.mjs` | Owner/member/viewer rules, stale changes, leave/removal and downstream access |
| `test-local-paper.mjs` | Paper persistence, authorization and version/limit handling |
| `test-local-file-management.mjs` | Atomic manifest edits, conflicts, private figures and permissions |
| `test-local-files.mjs` | Private storage, forged metadata, immutable fields, quota races and cleanup |
| `test-local-chat.mjs` | Channel isolation, newest bounded history, permissions and actual Realtime delivery |
| `test-local-overview.mjs` | Counts, metadata summaries, activity contract, access loss and partial failure; changed for Activity and not recorded as rerun afterward |
| `test-google-calendar.mjs` | Local status/authorization-URL diagnostic only; hardcoded client assertion and sensitive state URL logging require review before use |

Local integration harnesses need `.env.local` pointed at loopback Supabase and
Docker/services running. Invitations/Team mail scenarios additionally need the
invitation Edge Function. They create test accounts/projects and may execute
fixture SQL with local admin privileges. Most clean their own fixtures; auth mail
and some auth fixtures can remain. Never aim local fixture scripts at hosted or
production data, and never reset real projects as a shortcut.

There are no dedicated Task/Activity/Meetings end-to-end suites established by
this documentation. The Google diagnostic does not cover browser preflight,
cookies, consent or actual Calendar events. Tests that use Node fetch cannot
establish browser CORS correctness.

## Manual acceptance setup

Use isolated test projects and separate browser profiles for a verified owner,
member, viewer and outsider; also check logged-out/unverified states. Record the
revision, backend environment, browser/viewport, scenario, result and remaining
issue. Use real project content only with deliberate user authorization. Check
subsequent direct API/Storage access as well as visible controls when assessing
permission changes.

## Authentication, projects and team

1. Register, verify via local Mailpit, sign in, reload, sign out and reset the
   password. Invalid credentials must give an error; protected URLs must not
   reveal data to logged-out or unverified users. Check callback errors, expired
   recovery links, and pending invite context through signup/login.
2. Create a project with valid name/description. Reject blank/overlong input.
   Refresh and open its direct URL. Joined projects do not consume owned slots;
   archived owned projects do. Concurrent creation must not exceed five.
3. Invite a new/existing email as member/viewer. Only the verified intended email
   accepts; expired, revoked and already-consumed tokens must not grant new access.
   Confirm owner-only invitation management and duplicate-send protection.
4. Change access/research role, remove a teammate and self-leave. Stale updates
   must fail safely. Owner cannot demote/remove/leave themselves through Team.
   Removing/demoting someone changes future access across all tabs and storage
   while preserving contributions. Members/viewers can leave archived projects.

## Paper and files

1. Initialize a paper, edit/save using both button and Ctrl/Cmd+S, reload, and
   switch files with unsaved changes. Open two sessions and verify stale saves
   preserve the losing draft with an explicit conflict.
2. Create/rename/move/delete sources and folders, choose a nested main file,
   import a ZIP and add a PNG/JPEG. Validate path collisions, traversal, unsupported
   types, malformed images, compressed/decompressed limits and quota boundaries.
3. Compile a paper containing `\cite{greenwade93}` with a matching entry in
   `references.bib`, the correct bibliography filename and a bibliography style.
   The citation and References entry must both resolve. Missing entries should
   produce useful warnings; a generated PDF alone is not bibliography success.
4. Test compile errors, cancellation, timeout and unavailable package resources.
   Keep the last successful PDF but mark it stale after source changes. Verify
   page navigation/zoom, Source/Split/PDF modes and keyboard resizing.
5. Download a compiled PDF and ZIP, reopen their contents and verify snapshot
   consistency, figure inclusion and unsaved-draft choice. PDF export without a
   successful compile is unavailable; stale PDF export must be explicit.
6. Upload/search/filter/sort/rename/download/delete a general file. Check duplicate
   names and 50 MiB/500 MiB boundaries. Owner manages all uploads, members their
   own, viewers read only. Report binary-cleanup failure separately from metadata
   removal. Direct deletion of a referenced object must fail.

## Chat, tasks and activity

1. Use two sessions to send/delete chat messages and switch channels. Check recent
   ordering, reconnect/focus reconciliation, no stale channel content, per-channel
   drafts, IME input, Enter/Shift+Enter and the 4,000-character limit. Viewer and
   archived mutation attempts must fail. Sent does not imply read or online.
2. Create/edit/assign a task, set yesterday's due date, and exercise All/Open/
   Assigned to me/Unassigned/Overdue/Completed filters, search and pagination.
   Complete/reopen it and check Overview counts. Assignee-only access changes
   status, not unrelated fields; a different member cannot manage the task.
3. Demote/remove an assignee: unfinished work becomes unassigned and rejects stale
   saves, completed attribution stays. Reopening completed work clears an
   ineligible assignee. Safe creation retries produce one task/event. Deletion
   hides the task but retains history.
4. Perform changes across features, then compare Activity with Overview. Check
   actor/feature/local-date filters, 30-event cursor pages with concurrent new
   events, former contributors and unavailable-item links. Invitations are visible
   only to the owner. No event contains private bodies/tokens/notes/join links.
   A paper manifest transaction must not create an event for every replaced row.

## Meetings

1. Schedule as owner/member with attendees (including viewers), external HTTPS
   link, agenda and notes. Reload and open direct meeting details. Everyone on
   the project can read; only active owner/eligible organizer may mutate.
2. Reject invalid zones, title, end-before-start and non-HTTPS links. Check UTC
   persistence and viewer/original-zone display. `America/New_York` local
   `2027-03-14 02:30` is nonexistent; `2027-11-07 01:30` needs an occurrence choice.
3. Edit concurrently, retry a lost response, dismiss a dirty form and change
   project access while it is open. Preserve drafts and reject stale revisions.
4. Cancel with confirmation: retain notes/history, remove Join, show in Cancelled,
   and remove it from Overview's next meeting. Exercise past/ongoing/upcoming
   pagination, departed organizers and archived read-only behavior.

When Google work resumes, separately verify real-browser connect/decline/
reconnect/disconnect, exact callback/cookie binding, start-now/scheduled events,
asynchronous conference creation, unsupported accounts, expired authorization,
ambiguous failures/retries without duplicates, organizer versus owner sync,
ETag conflicts, cancellation and disconnect during an operation. Use a consenting
test organizer; real external events are side effects. Confirm shared notes and
attendee invitations are not sent. These checks are currently deferred.

## Settings and release acceptance

SETTINGS-01 is implemented locally; manual workflow acceptance remains pending.
Its lifecycle, recovery-window, transfer/quota, locking, stale-owner and
cross-feature acceptance checklist lives only in [task.md](../task.md). No
data-mutating Settings workflow tests were run for this increment.

For each delivered increment, review 375px, 768px and 1440px layouts, wide Paper,
200% zoom, keyboard-only use, focus return, long names/text, loading/empty/error
states and slow/offline requests. No current full accessibility audit is claimed.

Before a hosted release, verify the actual migration history, backend secrets,
Auth URLs, private storage and role isolation; test SPA direct links and compiler
assets in the deployed build; review backups, restoration and third-party
licenses. Resolve known release blockers and record exact evidence. Local
success alone does not certify hosted deployment.
