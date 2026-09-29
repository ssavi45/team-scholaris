# Test plan

Compilation report: verify success with/without warnings, PDF produced with errors,
failed/cancelled/running builds, unknown issue locations and stale-source guards.
Expand an issue, follow its source link, reveal original Technical details, switch
to Full log and open Build details. Check keyboard disclosure operation, narrow
panes and both themes. `test-compile-diagnostics.mjs` also checks readable message
classification without mutating original diagnostics.

## PDF rendering lifecycle regression

Run `node scripts/test-pdf-surface-lifecycle.mjs`: executes component effects with
controlled render promises to cover StrictMode replay, late cancellation after a
replacement render, bitmap disposal and shared-page ownership. This is a lifecycle
test, not browser rasterization. Manually recompile, resize, zoom, rotate and open
thumbnails in both themes; all pages must remain visible. Warning-only builds must
not open the diagnostics drawer. Errors must open it; Close diagnostics and Issues
must close/reopen it without losing the PDF or reading position.

## Compilation performance regression checks

Run `node scripts/test-compiler-session.mjs` with package-network permission as
needed. It benchmarks forced-three-pass/fresh-engine versus a ready workspace and
a one-line edit, checks engine/package reuse, deleted-input isolation, updated PDF
text, cancellation/failure recovery and bibliography resolution. Run the existing
real compiler and compiler-corpus scripts for nested mains, images and errors.
`node scripts/test-compiler-package-cache.mjs` uses a deterministic storage double
to check positive/negative persistence, expiry, origin restrictions, generated-file
exclusion, no-storage fallback and caching the ~10 MB format. It is not browser QA.

Manual: compile once, edit a line and recompile, then reload the workspace and
recompile. Check package network requests disappear on a warm cache; inspect
read/save, figure, engine timings and pass count in diagnostics. Test IndexedDB
blocked/full, cancellation, changing/deleting figures, source deletion, and access
revocation. Restart compiler and rebuild must remain available. First-ever packages
still require network downloads; cold-browser timing remains unmeasured here.


## Editor toolbar follow-up: manual check

- File: open, reopen closed tab, show current file in sidebar.
- Insert: bold/italic, section, bullet list, equation and figure; undo still works.
- Tools: go to line, toggle line comments, PDF text lookup and its unavailable hint.
- Settings: text size, wrap, indentation and expandable keyboard shortcuts.
- Menus close with Escape/outside click/Tab departure; Escape returns to the trigger.
- Ctrl/Cmd+F opens compact search above the editor. Checkboxes stay small and inline;
  Next/Previous, Select all matches, replacement and closing retain normal behavior.
- Check light/dark and narrow panes: menus stay within the editor, search is bounded,
  and the extra file-action toolbar row is absent.


## PAPER-09 acceptance and evidence

Automated: `node scripts/test-paper-pdf-tools.mjs` checks page/fit geometry, page-8
relative anchors, shrink-to-3 behavior, zoom anchoring, a 1,000-page canvas-window
bound, literal occurrence offsets, cancellation and safe-link protocols.
`node scripts/probe-paper-synctex.mjs` runs the real vendored engine on a 12-page
nested-main/include/BibTeX fixture, reports actual SyncTeX capability and verifies
PDF.js text search, bookmarks/destinations and external annotation URLs. This uses
the compiler package server/cache and may require network permission.

Manual (pending; no browser connected during implementation):
- Scroll through a 12+ page paper with wheel, touch and keyboard; no page switching.
- Read halfway down page 8, recompile, then shorten to 3 pages; retain/clamp position.
- Repeat zoom, fit, rotation, resize and focus; text-selection alignment stays accurate.
- Select/copy a phrase, navigate multiple search matches, follow a citation/external link.
- Inspect bookmarks and earlier/later thumbnails; direct page entry uses Enter.
- Use source/PDF text lookup; edit source and confirm stale lookup is disabled.
- In a long paper, verify at most 12 main canvases plus five thumbnail canvases;
  scroll away and confirm old bitmap memory is released (worker memory is separate).
- Check 375/768/1440px, both themes, keyboard focus and accessible text alternative.

Exact SyncTeX mapping and a separate preview window are not delivered features.


## PAPER-08 acceptance

Automated: `node scripts/test-paper-editor.mjs` checks cyclic included outlines,
comments/verbatim exclusions, literal/case/Unicode search offsets and caps,
nonmutating replacement and limits, approximate counts, corrupt/user-scoped
preferences, snippet selection/undo and read-only behavior. Also run draft/export
regressions and local rollback-only history safeguards; lint/build/diff checks.

Manual acceptance (pending):
- At 375/768/1440px in both themes, navigate Files/Outline/Search without clipping.
- Ctrl/Cmd+P, arrows, Enter: open a chapter; Ctrl/Cmd+G: jump to a line.
- Close/reopen tabs, change theme and revisit files: cursor, scroll and undo survive.
- Search unsaved drafts; select results and confirm exact text is highlighted.
- Preview replacement across two saved files, inspect changes, apply and recompile.
- Modify source in another session after preview: apply must reject the stale revision.
- Dirty/conflicted/offline/viewer/archived state must not allow replacement apply.
- Try snippets, completion, comment, undo, local replace and Ctrl/Cmd+Enter compile.
- Reload preferences; check user isolation and small-screen default single-pane layout.

No browser was available during implementation. Static and helper checks do not
replace these UI acceptance scenarios.


## PAPER-06 / PAPER-07 checks

Bibliography regression: a paper with no bibliography and an inline
thebibliography must not report missing bibdata/bibstyle. External bibliographies
in included chapters must resolve; missing style/database configurations must
still report errors. These are real WASM cases in the compiler corpus.

- `node scripts/test-history-diff.mjs`: stable identities and bounded source comparison.
- `node scripts/test-paper-history.mjs`: local rollback-only authorization, revisions,
  protected figures, retention, quotas, pagination and restore safety.
- `node scripts/test-paper-history-integration.mjs`: disposable local Auth/project/
  Storage fixtures, real figure deletion protection, HTTP 409 on stale restore,
  restored chapter/image compilation; fixtures removed in finally.
- `node scripts/test-compile-diagnostics.mjs`: nested/explicit/unknown locations,
  grouping, bibliography guidance, preparation cancellation and network errors.
- `node scripts/test-compiler-corpus.mjs` and `node scripts/test-paper-compiler.mjs`:
  real WASM fixtures, bibliography/cross-reference rendering, images, custom
  styles/classes, failed input, timeout/cancellation and clean worker isolation.
- `node scripts/benchmark-paper-compiler.mjs`: separate cold/warm temporary package
  cache; report Node/OS and network conditions, not browser performance claims.
- Run existing draft/export regression checks, lint, build and `git diff --check`.

Manual acceptance still required: open History as member/viewer; name/compare/
download a checkpoint; delete and restore a chapter/figure; verify dirty drafts
block restore; edit in another tab and verify refresh is required. Inspect narrow
screen and both themes. Break a nested source command, navigate to its line,
repair/recompile; verify warnings versus fatal errors, cancellation during figure
loading, last-good PDF, stale-location disabling and keyboard focus. Observe
read/save, figure and engine timings in diagnostics with browser cache cold/warm.

### Tested compiler compatibility

| Feature | Current result |
| --- | --- |
| pdfLaTeX articles, nested inputs/main, math, tables | Real WASM fixtures pass |
| BibTeX and plain style, citations and references | Valid fixture renders; malformed/missing data yields diagnostics |
| PNG/JPEG figures | Real WASM fixtures pass; corrupt images may fail engine decoding |
| Project-local .cls/.sty | Real WASM fixtures pass; no cross-project filesystem reuse |
| Latin accents through TeX commands | Fixture passes |
| Arbitrary Unicode scripts | Not supported generally; Bengali fixture yields explicit input error |
| Missing package | Actionable failure; availability depends on the configured package service |
| XeLaTeX/LuaLaTeX/Biber/system fonts/shell escape | Not supported; requires a separately approved runtime |

Browser visual/device acceptance and broad package compatibility are not implied
by this matrix. Compile-on-save is intentionally deferred until manual acceptance.


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

## Paper layout rebuild: manual acceptance pending

- At 375/768/1440px in light/dark, verify readable compact bars, no horizontal
  page overflow, independent pane scrolling and reachable menus/controls.
- Resize both dividers by drag and arrow keys. Collapse/reopen Explorer. Check
  long/nested names, filter/no matches, folder toggle, hover and context actions.
- New source/new folder must open the correct staged creation mode. Rename/move/
  delete opens the selected item; dirty/compiling/read-only states block mutation.
- Open multiple file tabs, edit each, close/reopen a dirty tab and undo. Drafts
  must remain; closing the final tab shows an empty editor, not discarded work.
- Toggle layout icons, editor/PDF full-screen, Escape and exit buttons. Dialogs
  must remain usable. Leaving Paper restores normal navigation.
- Recompile while viewing a later PDF page; preserve page/zoom/scroll, clamp when
  output shrinks. Test page input, zoom, fit page/width, rotation and resizing.
- Search literal text across pages; jump via excerpts. Changing query or PDF must
  invalidate stale results. Check no match, textless pages and search failure.
- Confirm autosave and errors remain truthful, recovery/conflicts auto-open, and
  compile failures retain an explicitly outdated previous PDF. Test export/log.
- Team avatars show saved profile choices and never imply online presence.

Automated helper regression: `node scripts/test-paper-pdf-tools.mjs` checks page
clamping, fit geometry, literal page search and cancellation. Draft/export suites
remain applicable; these are not substitutes for browser interaction acceptance.

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

## Dark mode and theme switching (THEME-01)

1. **System & Initial Load**:
   - First visit follows OS color scheme without bright flash (`theme-init.js`).
   - Changing OS color scheme updates the active theme when no explicit user override exists.
   - Setting a theme persists across hard refresh and sign out.
2. **Interactive Toggle**:
   - Animated toggle in AppShell (including Paper) and AuthLayout transitions in 280ms, with no duplicate Paper toggle.
   - Sun/Moon icon rotation and track sliding work on desktop and mobile.
   - Reduced motion (`prefers-reduced-motion: reduce`) removes all transition animations.
   - Multi-tab synchronization: toggling theme in one tab immediately updates other open tabs.
3. **Contrast & Readability**:
   - Run `node scripts/test-theme.mjs` for bootstrap, OS preference, storage events,
     blocked storage, and token contrast assertions (text >=4.5:1, control borders >=3:1).
   - Inspect actual rendered text, placeholder, focus, disabled, hover and selected
     states in every tab; token tests alone do not establish page-level compliance.
   - Verify inverted wordmark with no white rectangle, rounded account badge and
     favicon corners in light/dark browser chrome. Check narrow 320px headers.
   - Inspect chat channel names, About/quote cards, task/activity metadata, auth
     labels, file dialogs, errors, PDF controls and compile states specifically.
4. **Paper Workspace Isolation**:
   - Switching theme reconfigures CodeMirror syntax highlighting without resetting document text, cursor, or undo stack.
   - Compiled PDF pages and preview canvases strictly maintain authentic white paper background.

For each delivered increment, review 375px, 768px and 1440px layouts, wide Paper,
200% zoom, keyboard-only use, focus return, long names/text, loading/empty/error
states and slow/offline requests. No current full accessibility audit is claimed.

Before a hosted release, verify the actual migration history, backend secrets,
Auth URLs, private storage and role isolation; test SPA direct links and compiler
licenses. Resolve known release blockers and record exact evidence. Local
success alone does not certify hosted deployment.

## PROFILE-01 acceptance

Automated local access checks: `node scripts/test-profile-access.mjs` (requires
local Docker/Supabase; fixtures are rolled back). Covers generated usernames,
profile save/stale-write rejection, saved teammate-photo visibility, draft and
private-profile isolation, and stranger/removed-member denial.

Manual checks pending:
- Open profile from badge; edit name/username and switch email/username label;
  save, reload and verify persistence across sign-in/devices.
- Select each of ten presets; upload valid photos from desktop/mobile and verify
  cropping, saved preview, navbar and chat header/message/member-list consistency.
- Reject invalid/oversized files and duplicate usernames; retain draft on failure.
- Check unsaved navigation/sign-out, stale saves across tabs, remove-photo and cleanup.
- Verify teammate photo updates after refresh/focus and initials for former members.
- Check light/dark themes, keyboard focus and 375/768/1440px layouts.
