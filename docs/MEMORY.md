# Project memory

File manager close control now uses a 22px X in a bordered 44px target, theme-aware
contrast and visible hover/keyboard focus states. Busy-state disabling is retained.

## Explorer create-action routing

New source file and New folder now open dedicated name-entry dialogs, persisting
on Create through the existing authorized/revision-checked manifest API. Source
creation requires a supported extension and opens the new file in the editor.
Folder creation adds an empty folder. Upload or manage files alone opens the full
manager. Duplicate/invalid paths show inline errors; Cancel makes no changes.
If refresh fails after successful creation, retry reloads instead of creating again.

## Simplified Paper file management — 2026-10-01

Prominent Upload files / Import ZIP / Delete all files, individual Rename/Delete
rows and one Save changes action. Non-conflicting uploads join the editable list
directly; collisions/skipped files retain review. Cancel discards unsaved file
changes. Templates/new-file tools/limits are collapsed to reduce clutter.

Deleting the main file automatically selects another .tex when available; no .tex
means blank main_file. Empty/support-only workspaces are valid. History remains
accessible after clearing; the empty workspace can reopen the uploader. Compile
without .tex gives an actionable message. No project deletion or user data clearing
was performed; Delete all is a UI capability requiring user confirmation and Save.

Applied 20261001000100_empty_paper_workspace.sql and
20261001000200_empty_paper_history.sql LOCALLY only. The history follow-up fixes
empty safety snapshots which initially blocked restoration after a clear.
Local disposable authenticated tests passed clear/reopen/repopulate, support-only
upload, recover cleared files, restore empty snapshot and viewer delete rejection.
Helper/asset checks, lint/build passed; visual browser acceptance remains pending.
Hosted environments need both migrations before this flow is enabled there.

## PAPER-12 architecture proof — 2026-10-01

Delivered isolated Yjs coediting model in scripts/coediting and executable
test-paper-coediting.mjs (`npm run test:coediting`). Dev-only Yjs 13.6.33 and
y-codemirror.next 0.3.6; no runtime import, UI change, migrations or hosted rollout.
The gateway models signed fixture auth/current roles, isolated candidate validation,
disk-before-ACK persistence, revision snapshots and file-generation fencing.

Local fault/restart/auth-model/undo tests pass; two/five clients converge on roughly
10/100/400 KiB manuscripts. Latest persist p95 3.38–12.86 ms on local disk, not a
browser/network promise. TEST_PLAN records results and limits. CodeMirror extension
state construction is checked; rendered binding is NOT verified. The process-restart
test required execution outside sandbox after child spawn was denied.

DECISIONS recommends Yjs with a trusted persistent gateway, pending hosting/budget
and real Supabase/browser integration gates. ARCHITECTURE defines migration, legacy
RPC fencing, coherent snapshots, restore/delete generations and rollback. Prototype
evidence is delivered; production coediting decision remains conditional. Next:
PAPER-12 integration acceptance before PAPER-13 controlled rollout. Do not label
the current workspace live coediting or use these fixture scripts as a server.

Dependency install exposed an existing brace-expansion advisory. Compatible patch
updated the lockfile; npm reported zero vulnerabilities after update.
Prototype regressions, lint, production build and whitespace checks passed.
The existing application chunk-size warning remains; production bundle contents
do not include the prototype or its development-only Yjs dependencies.

## Figure insertion safety follow-up

Figure insertion now captures the original source/selection, rejects stale source
or revoked editing permission without closing the dialog, and places the cursor
after the inserted snippet. Cancel restores editor focus. Regression coverage
checks selection replacement, cursor position, one-step undo, stale source and
read-only rejection. Browser interaction acceptance remains pending.

## Editor Undo / Redo controls

Added compact Undo and Redo buttons beside File in the source toolbar. They use
the existing per-file CodeMirror history, disable when unavailable or read-only,
show shortcut hints, and return focus to the editor. Manual UI acceptance pending.

Small toolbar follow-up: only one editor menu stays open, action dismissal returns
focus to its trigger unless the action already focused another control, figure
action wording is corrected, Undo/Redo appear in keyboard help, and disabled
toolbar/search controls no longer receive active hover styling. Shortcut hints
can shrink in narrow menus. Manual keyboard/visual acceptance remains pending.

## Recompile latency follow-up

Overlapped fresh project/access metadata reads with the existing revision-bracketed
source read after draft saves drain. Five serial read round trips become a longest
chain of three. Both settle before access is checked and compilation proceeds;
removed access still clears the previous preview and compiler. No stale-source
shortcut and no autosave debounce added to compilation.

Worker now memoizes successful BibTeX output only within a single clean build when
bibliography aux directives plus local bib/bst inputs remain identical. It checks
the bbl remains unchanged and replays bibliography diagnostics. The memo resets
on every workspace reset; manuscript outputs are not reused between jobs or stored
in the public package cache. Adaptive LaTeX reference passes are unchanged.

Real session checks passed for updated PDF content, removed chapters, failure/
cancellation recovery, changed bibliography and preserved missing-key warnings.
Representative Node harness: inline equation + bibliography 889 ms, three LaTeX
passes, one BibTeX build. Not a browser/network benchmark or guaranteed speedup.
Read/save, figures, engine, passes and bibliography-run count appear in build details.


## Equation composer handoff

Implemented Insert > Insert equation with free-form LaTeX, four layouts, optional
numbering/labels, editable templates/symbols, local debounced preview and source
inspection. Selected simple equation delimiters are recognized; first-row align
labels remain in place. Insertion is a single undoable transaction and rejects
stale source/read-only state. Explicit amsmath setup preserves current drafts and
uses normal autosave; setup is a separate edit, not undone by cancelling the dialog.

Added KaTeX 0.18.9, lazy-loaded with local fonts, no CDN. Preview restrictions and
custom-macro fallback are documented in SECURITY and DECISIONS. Browser connection
was unavailable; UI/theme/keyboard/manual persistence acceptance remains pending.
Equation helper tests, real LaTeX compilation of all layouts/building blocks,
editor/draft regressions, lint, production build and whitespace checks passed.
Existing bundle-size warning remains. PAPER-12 subsequently reached the local
prototype stage; see the newer handoff above.


## PAPER-11 handoff ? 2026-09-30

Implemented rename/move previews in the existing file manager, including optional
literal input/include/includegraphics/bibliography rewrites. Resolution follows
the compiler's project-root working directory. Ambiguous/dynamic paths and custom
search paths require manual repair. Existing dirty/recovery guards and atomic
revision-checked manifest/history RPC remain authoritative; no schema changes.

Import review now requires explicit keep/replace/new-path choices for collisions,
lists entry candidates, and warns about unsupported engines/skipped files. Three
original starters (article/report/multi-file thesis) use the same non-destructive
staging flow. Existing files are retained unless replacement is explicitly chosen.
Explorer retains search/collapsible folders and adds F2 for file actions.

Insert ? Insert uploaded figure previews an authorized PNG/JPEG and adds a caption,
label and root-relative path at the selection in an undoable transaction. Escapes
caption text, rejects duplicate literal labels, and reminds authors about graphicx.
Image uploads/ZIPs check signatures and dimensions (16,000px/side, 40MP), alongside
existing size/quota checks. Backend permissions/Storage limits remain unchanged;
client dimension checks are not a new trusted server image-decoding boundary.

Automated helper and real-engine starter tests passed; test includes renamed
chapter export/reimport and compilation. Editor/draft/reference regressions,
lint, production build and whitespace checks passed. Existing bundle-size warning
remains. Browser/backend manual acceptance remains pending.
Optional General Files copying and PDF/SVG/EPS conversion remain deferred.
PAPER-10 manual acceptance also remains pending. PAPER-12 is now a local prototype,
with production integration gates open.


## PAPER-10 handoff — 2026-09-30

Implemented local citation/reference assistance. Insert → Citation searches
author/title/year/key; Insert → Cross-reference lists labels. Both insert at the
source selection in one undoable transaction. Known keys complete inside supported
cite/ref commands; ambiguous duplicate keys are excluded. Tools → Manage references
& check keys browses drafts and reports missing/duplicate keys with source links.

The manager supports common entry creation/editing, UTF-8 .bib upload/paste,
per-duplicate keep/replace/rename choices, and citation-key rename previews.
Changed fields/keys are patched by offset, preserving unfamiliar fields, nested
braces, strings, comments and untouched bytes. Unhandled macro/key occurrences
and BibTeX dependency fields are flagged. Raw source and setup help remain available.

Changes preview a coherent saved revision and use the existing atomic manifest
RPC/history. Dirty/conflicted/offline/read-only states block apply; backend
authorization/revision checks remain authoritative. No migration or dependency.
DOI lookup and Zotero/Mendeley sync are explicitly deferred; no external lookup.

Verified parser/planner/CodeMirror checks and real WASM greenwade93 repair, including
author/year in PDF text. Editor and draft regressions, lint, production build and
git diff whitespace checks passed. The build retains the bundle-size warning.
Browser modal/theme/
keyboard and end-to-end persistence acceptance remain manual; the real compiler
test exercised the same import planner, not browser UI. PAPER-11 was subsequently
implemented; see the newer handoff above.

Find & replace no longer flex-shrinks against the editor, which clipped the
replacement row. Its natural height can grow up to 320px (bounded by half the
editor/45dvh), with vertical scrolling for smaller panes.

PDF toolbar now groups chevron page navigation around a centered current/total
page box. Direct page entry uses numeric text input without number spinners.
Zoom appears once in its selector (fit modes include their actual percentage);
navigation, zoom and view tools have separate groups and labelled hover targets.

Compiler options now separate read-only compiler/main-file information from three
bordered action buttons: Choose main file, Restart & recompile, View compilation
report. Buttons include descriptions, icons, hover/focus feedback and disabled
reasons. Compatibility/cache information is collapsed. Actions dismiss the menu;
Escape, outside-click and focus departure also close it. Visual acceptance pending.

## Compilation report clarity

Replaced issue-by-issue pagination with compact expandable rows, errors first.
Build outcome is explicit (PDF ready, failed, cancelled or compiling); warnings
do not imply PDF failure. Common TeX messages have plain-language titles and
guidance. Original messages/context live under Technical details, full output
has its own view, and timings/revision/credits are under Build details. Source
links remain guarded against stale source; report header stays visible while
its body scrolls. Manual visual acceptance remains pending.

## PDF preview recovery

Fixed a PDF surface ownership race: StrictMode replay or delayed cancellation could
zero the canvas already reused by a newer render. Each effect now owns a separate
canvas and releases only that bitmap; shared page resources stay with the document.
Warning-only compiles leave the PDF visible. Errors still open diagnostics; the
drawer is height-bounded and has an explicit close action and labelled Issues button.
Lifecycle regression and PDF helper checks passed. Browser connection unavailable;
confirm the reported black preview is gone in both themes after refreshing.

## Compilation speed follow-up

Implemented workspace engine prewarming/reuse, persistent bounded public package
caching (including negative lookups and the ~10 MB format), generated-reference
stability checks to avoid unnecessary third passes, and workspace-only caching of
unchanged figures. Every new compile still clears /work and rechecks project/source
authorization. Cancellation/failure/access loss retires the engine; Restart compiler
and rebuild clears the workspace engine/figure caches for recovery.

Observed local Node/WASM harness timings for a small paper: old-style fresh engine
with three passes 1,404 ms; ready-engine first compile 947 ms (two passes); one-line
edit 575 ms (two passes), with no repeated package requests. These are not browser
cold-network measurements. First-ever package downloads still take network time.
Real compiler/corpus tests cover bibliography, nested source, figures, errors and
isolation. Persistent package-cache behavior is tested with a storage double;
browser cache/performance acceptance remains manual.


## Editor UI follow-up

Consolidated the two editor action rows into one labelled toolbar. File actions
moved into File; Insert uses descriptive template names; secondary commands live
in Tools; Editor settings includes readable preferences and shortcut help. Native
disclosures support outside-click/focus/Escape dismissal. CodeMirror search now
opens above the source, with scoped compact checkbox/input styles and plain labels.
The oversized search panel came from global form styles leaking into CodeMirror.
Build passed; visual browser verification remains pending (no browser available).


Last updated: **2026-09-29**, after PAPER-09 implementation.

## PAPER-09 handoff

The PDF viewer now scrolls continuously. Metadata establishes page-sized slots;
only nearby canvases/text/link layers mount, with bitmap size caps and cancellation.
Page/relative offset, zoom and rotation survive recompiles; shorter outputs clamp.
Added selectable text, occurrence search/highlighting, actual zoom display, direct
page entry, keyboard zoom, nearby thumbnails, PDF bookmarks and safe link overlays.
Accessible page text remains available. Source/PDF text lookup is explicitly
approximate and disabled when output is stale; selections/search bind to PDF bytes.

The real engine probe compiled a nested main, include and bibliography, reported
SCHOLARIS-SYNCTEX-UNAVAILABLE, and produced no SyncTeX file. Exact coordinate mapping
is therefore not offered. Separate-window preview remains gated on its lifecycle.
No production compiler changes, migrations or dependencies were introduced.

Passed: lint/build, PDF helper geometry/anchor/search/safe-link tests, and a real
12-page PDF integration covering occurrence search, outline destinations and link
annotations. Existing large-chunk warning remains. Browser discovery returned no
browser: visual selection alignment, real scrolling and mobile/theme acceptance
remain manual. Next increment is PAPER-10 after acceptance.

## PAPER-08 handoff

Implemented Files/Outline/Search, literal project search including drafts, precise
result selection, quick file switching, go-to-line, reveal file and tab reopening.
CodeMirror retains per-file cursor/scroll/history in this workspace session.
Dirty/conflict markers reuse the draft store. Added snippets/completion, comment
and compile shortcuts, options/help and approximate current-file word counts.
User/device preferences cover font, wrap, indentation and layout. Search/replacement
is literal, bounded and case-selectable. Multi-file replacement previews coherent
saved source and applies via the existing atomic revision-checked manifest RPC;
unsaved/conflicted/recovery/offline state blocks apply. No new migration/dependency.

Passed: npm lint/build, editor helper and snippet undo/read-only tests, draft/export
checks and local rollback-only history permission/revision checks. Build retains
its existing large-chunk warning. No browser was available: keyboard, mobile,
theme switching and full UI replacement acceptance remain manual.

## Previous position

PAPER-07 follow-up: the worker now inspects generated main/included auxiliary
files before running BibTeX. Papers without external bibliography commands,
including inline thebibliography, no longer report spurious missing bibdata/style
errors. Incomplete external bibliography configurations still produce diagnostics.
The reported IEEE paper did produce a four-page PDF; its remaining box warnings
concern manuscript layout rather than a failed compile.

PAPER-06 adds History in the paper project bar: automatic/named/safety snapshots,
source/tree comparison, ZIP download, individual-file and complete-paper restore.
Restores preserve a safety checkpoint and reject stale revisions. Historical
figures remain private and protected; file versions cannot be reused after restore.
Migrations 20260928000100 and 20260928000200 were applied only to local Supabase.
The second maps expected history conflicts to HTTP 409, avoiding gateway retries.

PAPER-07 adds grouped compiler diagnostics, repair hints, issue navigation and
explicit source links where the engine reports a reliable location. Source changes
disable stale diagnostic jumps. The last good PDF survives failure/cancellation;
results record revision/main file and show preparation/figure/engine timings.
Every rebuild uses a fresh worker filesystem; optional compile-on-save is deferred.
Google Meet was reported resolved by the user on 2026-09-29. No Google code was
changed or live Google flow verified during PAPER-08. Older paused-state notes
below are historical. Next functional increment is PAPER-10 after PAPER-09 acceptance.

Verification: history authorization/quotas/restore rollback checks, authenticated
Storage + restored-paper WASM compilation, source diff, draft and export checks,
diagnostic tests and real compiler corpus passed. Corpus includes PNG/JPEG, custom
class/style, math/tables, malformed/missing bibliography, unsupported Unicode and
cross-project filesystem isolation. On Windows x64 / Node 24.16.0 the isolated
benchmark measured 6051 ms cold package cache and 809 ms warm for a small article.
These are harness measurements, not browser/device performance claims.
Browser visual acceptance remains pending (no connected browser). Hosted history
migrations are not deployed. No dependencies added; no commit or push performed.
Final lint, production build and whitespace checks passed. The existing bundle-size
advisory remains. Optional compile-on-save is not implemented in this increment.

## Previous layout delivery

Paper polish: the navbar uses content-driven height with 10px internal vertical
padding so the navigation/profile pills clear its bottom border. There is no
external gap above the project bar. The rounded back button and labeled Export
button use the existing light/dark theme tokens.

The user reverted the earlier UI pass. This rebuild starts from that reverted
baseline while preserving PAPER-05's per-file autosave, recovery and conflict
handling. Paper now has a compact opaque app header and a compact project bar;
project links live in its actions menu. Explorer/Editor/PDF fill the remaining
viewport with draggable and keyboard-accessible dividers. File tabs retain
underlying drafts when closed. Explorer filters paths and opens the existing
staged file manager for creation, folder operations, upload/import and mutations.

PDF controls now include page entry, actual percentage zoom, fit width/page,
rotation, document-text search with matching-page excerpts, and full-viewport
focus. Search jumps to pages; it does not highlight canvas glyphs. Focus mode
maximizes within the browser viewport, preserving the browser's own chrome.
Member avatars identify the project team, not online presence; live cursors and
anchored comments remain future work. Compiler engine remains pdfLaTeX/BibTeX;
entry-file changes reuse the file manager. No dependencies or migrations added.

Visual acceptance remains pending: browser discovery returned no connected
browser. History has since been implemented; Google Meet remains paused.
The pre-PAPER-05 roadmap baseline in task.md is retained as historical planning.

Verification: lint, production build, diff whitespace checks, draft/export
regressions and the new PDF helper suite pass. The build still reports the
existing >500 kB bundle advisory. No hosted or local database changes were made.

PROFILE-01 is implemented locally: protected profile editor, generated editable
usernames, username/email badge preference, ten artwork avatars, uploaded photos,
private bio/affiliation, live preview and unsaved/stale-save protection. The badge
links to `/profile`. Chat header, message and sidebar avatars reuse the saved
profile avatar; current-user changes use the shared provider immediately.
Teammate avatars refresh on conversation refresh, focus and a 45-minute interval.
Former members retain initials fallback. No email/bio/affiliation is shared.

Local migrations `20260927000100` and `20260927000200` applied successfully.
Lint passes without warnings; build passes with a bundle-size advisory.
`node scripts/test-profile-access.mjs` passes rollback-only local checks for
username generation, profile saves, stale-write rejection, teammate access,
private draft/profile isolation and stranger/removed-member denial. Browser
upload/rendering acceptance and hosted migration rollout remain pending.


The account badge now shares its pill shape and compact circular sizing across
light and dark modes, using the existing theme surface/border/text tokens.

Navbar refresh: AppShell now has a sticky glass header, active navigation pills,
project/Paper shortcuts, and an email-initial account badge. Mobile navigation
wraps into a second row; Paper retains its compact single-row mobile header.
The existing sign-out and unsaved-change guards are preserved. Browser visual
acceptance is pending because no browser was connected during implementation.
Lint, production build and diff whitespace checks passed for this refresh.

Branding update: the supplied PNG favicon is linked in index.html, and the
shared BrandLogo component displays the supplied wordmark on application/Paper
headers and auth screens. Responsive sizing replaces the previous text/S badge;
the original image files are preserved. The favicon now uses a tightly framed
`team-scholaris-favicon-v2.png` so its mark fills the browser tab icon area;
the new URL avoids reusing the previously cached padded image.

Team Scholaris has a working local research-workspace foundation and multiple
delivered increments. **SETTINGS-01 is implemented locally and awaiting the user's
manual acceptance. Google Meet work remains paused by the user.**

The only build tracker is [root task.md](../task.md). It contains the paper-first roadmap and retained prior delivery records. Do not resume
Google integration or start another increment merely because it appears in the
product roadmap.

## Implementation and acceptance ledger

| Increment | Current evidence |
| --- | --- |
| AUTH-01 / PROJECT-01 | Email auth and private project flows implemented; user demonstrated login and project creation |
| INVITE-01 / TEAM-01 | Invitations, membership access/research roles, removal and leave implemented; prior local integration checks documented |
| PAPER-01 through PAPER-04 | Editor, saves, browser compilation, PDF preview, exports, tree management, figures and ZIP import implemented; user confirmed PDF/ZIP downloads and reference correction |
| FILES-01 / CHAT-01 | Private files and channel chat implemented; September review fixes retained; user reports chat UI issues fixed |
| Shared project shell | All ordinary tabs use ProjectTabShell; Paper remains independent/full-width |
| OVERVIEW-02 | Project summaries, counts and shortcuts implemented; later Activity/Tasks/Meetings integrations supersede original summary behavior |
| TASK-01 | Implemented; user reported working |
| ACTIVITY-01 | Implemented; user reported manual acceptance |
| MEETINGS-01 | Scheduling, zones, attendees, external links, notes, cancellation and summary/history integration implemented; full manual checklist not recorded as passed |
| MEETINGS-02 | Code and local configuration/migrations exist; browser connection fails; paused, live Google acceptance incomplete |
| SETTINGS-01 | Settings route, owner detail/lifecycle/transfer RPCs and Dashboard Trash/recovery implemented; local migration applied; manual acceptance pending |
| THEME-01 | Readable dark mode with animated theme switch implemented; charcoal/forest-green tokens, CodeMirror Compartment themes, and Paper isolation; manual acceptance pending |

Reports of historical verification apply to that revision and environment. They
are not evidence that the current tree or hosted deployment has just passed.

## THEME-01 delivery

Readable dark mode (`#101713` page, `#18221C` cards, `#202D25` raised, `#EDF3EE` text,
`#B5C3B8` secondary, `#95D5AC` accent) is implemented across all surfaces. An animated
sun/moon toggle switch with a 280ms cubic-bezier sliding track is placed in AppShell,
and AuthLayout; Paper inherits the AppShell control without a duplicate. Theme state follows OS preference,
persists in localStorage, synchronizes across browser tabs, and initializes before
first paint via `public/theme-init.js` to eliminate bright flashes. The Paper
workspace utilizes a dynamic CodeMirror `Compartment` to switch between light and
dark syntax themes in place without resetting editor state or undo history, while
compiled PDF pages strictly maintain their authentic white document background.
Review fixes invert/screen-blend only the wordmark in dark mode, round the account
identity into a pill, replace nonexistent theme selectors, and cover previously
dim labels, chat sidebars, secondary metadata, dialogs, avatars and Paper controls.
The favicon now uses a self-contained rounded SVG wrapper around the existing PNG.
The root App keeps theme event subscriptions active on all routes. LaTeX command
highlighting and comment/gutter contrast were improved without rebuilding editor state.

Verification: lint, production build and the focused theme bootstrap/storage/event
and token contrast checks passed. Minimum tested text contrast is 6.24:1 and control
border contrast 3.52:1. No connected browser was available; visual acceptance,
scrolling, mobile layout and interactive editor-state verification remain manual.

## SETTINGS-01 delivery

Project Settings is after Meetings in the shared shell. Owners can save project
details, archive/unarchive, transfer immediately to an eligible verified member,
or move research to Trash. Other teammates see a read-only summary. Confirmation
dialogs protect lifecycle changes, typed project names protect transfer/Trash,
and explicit acknowledgement explains transfer/restoration access changes.

Dashboard now has Projects/Trash views. Only owners see their deleted-project
metadata. The server enforces the 30-day recovery window and ownership quota;
restoration returns archived research with retained teammates. Existing content,
binary assets and history are preserved; pending invites stay revoked. There is
no automatic purge and no Google Calendar side effect.

The new migration adds settings revisions, private caller/request-bound retry
receipts, sorted quota locks compatible with create_project, narrow RPC grants
and a separate Trash read path. Existing Activity triggers record lifecycle
changes. Browser failures preserve drafts and retry identity. Dashboard refreshes
on focus and project changes; Settings refreshes without replacing dirty forms.

The local migration applied successfully. Lint, the production build, diff
whitespace, documentation links and new-file whitespace checks passed. No automated
workflow fixtures or real project management actions
were performed; the manual matrix remains pending. No new dependencies were added.

## Important retained fixes and behavior

The 2026-09-19 review corrected newest-message retrieval/reconciliation, stale
chat state, direct message mutation permissions, file metadata forgery and quota
races, referenced-object deletion, nested-main compilation/BibTeX retrieval,
paper selection freshness, and import bounds/worker cleanup. It also removed
fabricated presence/read states and duplicate navigation. These protections must
survive future refactors.

Activity now uses durable database events, not an inferred list of current files
and messages. Existing task events are preserved; earlier untracked actions are
not backfilled. Meetings are now present despite old per-build notes describing
them as future work. Those superseded notes have been consolidated, not retained
as alternative instructions.

## Known issues and open decisions

1. **Google connection — historical, user reports resolved:** the local Supabase gateway intercepted a credentialed
   browser preflight and returned wildcard origin without the required credential
   permission. `google-calendar-api.ts` uses `credentials: 'include'` for OAuth
   browser binding. Consequently the browser can reject the request before the
   function handles it. A same-origin development proxy was considered but has
   not been implemented at that time. The user subsequently reported resolving
   Google Meet before PAPER-08. Do not treat this historical diagnosis as an
   active blocker; agent end-to-end verification is still unrecorded.
2. Function reachability or Node fetch success does not test browser CORS, cookie
   binding, user consent, live event creation, synchronization or cancellation.
   No successful end-to-end Google flow or agent-created live event is recorded.
3. `scripts/test-google-calendar.mjs` is a local diagnostic, not full acceptance.
   It checks a specific OAuth client ID, prints an authorization URL containing
   state, and runs outside browser CORS. Review/redact it before resuming or
   sharing its output; do not use its success banner as proof the UI works.
4. Google sign-in provider setup is separate from Calendar credentials. The
   frontend flag alone cannot configure either backend integration.
5. Original viewer-chat permissions conflict with current read-only behavior.
   Current implementation is preserved; confirm the beta policy explicitly.
6. Realtime paper coediting is not implemented. Current optimistic version checks
   protect explicit saves but do not merge concurrent authors' edits.
7. Storage cleanup can leave unreferenced binaries after interrupted deletion.
   Retention/purge automation and production recovery procedures need future work.
8. A prior Vite build reported a non-blocking bundle-size warning. Production
   performance and accessibility have not received a complete current audit.

## Environment and deployment state

Docker-backed local Supabase has been used successfully. The project also has a
hosted Supabase environment and GitHub repository. Prior build notes record local
migrations through `20260920000500_google_oauth_completion.sql`; SETTINGS-01 then
applied `20260926000100_project_settings.sql` locally without resetting data.
Hosted parity is unverified: several
later builds explicitly applied changes only locally.

Docker Desktop was started for the Settings migration. Local frontend reference
origin is `http://127.0.0.1:5173`; API is port 54321,
Studio 54323, Mailpit 54324. Actual current process availability is not assumed.
See [README](../README.md) to start services. Preserve ignored existing environment
files; only their examples belong in version control. Do not record account
credentials, OAuth secrets, or real project data in memory.

Google Cloud client/API/consent setup was reported completed by the user. The
backend example documents its callback and secret names, but operational browser
authorization was subsequently reported fixed by the user. No production frontend hosting or complete hosted
rollout is certified. No commit, push or hosted deployment was performed for Settings.

## Handoff

Read [RULES.md](../RULES.md), this file and [task.md](../task.md), then inspect the
current tree before working. Existing local changes include application work
from previous increments; do not discard them. Next, collect the user's Settings
acceptance and address concrete findings before selecting a new build. Preserve
all retained research data. Keep the single task tracker current, record exact verification
performed, and update this memory at handoff. User workflow acceptance is manual
unless they request otherwise; do not silently claim unperformed checks passed.
