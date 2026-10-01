# Architecture

## Coordinated live lifecycle and retained history

The current manifest RPC is apply_shared_paper_manifest. Under the project-first
lock and expected revision it preserves enrolled file ID/epoch/state for unchanged
source (including rename). It permits adding other files without ending live writing.
Deleting/replacing live text requires explicit owner confirmation and a protected
safety checkpoint. Legacy manifest/save RPCs remain fenced. Validation failures roll
back files, sessions and history together. Atomic read_paper_state returns files,
session markers, main and revision together while authors continue writing.

restore_shared_paper_history uses the existing comparison/revision/safety protocol;
it ends only affected live sessions, even if restored text is identical. Other live
files keep their causal state. Restored/deleted/replaced generations require explicit
owner enrollment with a new epoch. Old queues remain separate recovery drafts.
No automatic causal replay into a historical source or automatic reenrollment.
Current checkpoint/manifest/restore endpoints report stale previews as PT409.
PostgREST maps the old 40001 code to HTTP 500; explicit HTTP 409 keeps expected
conflicts out of upstream failure handling. See [PostgREST error mapping](https://docs.postgrest.org/en/stable/references/errors.html).

Every newly captured history point atomically retains its active Yjs checkpoints,
epochs and sequences in private paper_history_shared rows. State bytes count toward
the existing 50 MiB history quota; retention/pruning/deletion cascade both text and
causal data. Archives are retained for rollback/audit, not exposed to browser clients.
Existing named/safety protection and immutable figure retention continue unchanged.

Presence uses service-only PostgreSQL leases (10 seconds) across gateways. Each
heartbeat/read checks current verified membership and epoch; names/colors are
server assigned. Revoked participants are filtered immediately, dead process leases
expire, and close removes own presence when possible. Project then actor advisory
locking serializes 50 peers/file and 10 sessions/actor limits. Database rate buckets
serialize 120 operations and 300 cursor messages per actor/minute across gateways;
IP, process admission, queue and byte limits remain additional gateway guards.
Polling cost and representative production load still need operational acceptance.

Avatar following scrolls to a relative cursor without changing the local selection;
local cursor movement stops following. Role changes do not recreate the editor.
Rename metadata changes the dialog/download path, not the underlying Y.Doc.

## Saved build snapshots during live writing

capture_paper_snapshot locks the project briefly, rechecks verified current
membership/nondeleted status, checks an optional file/epoch/minimum durable sequence,
then returns files/main/revision/shared clocks together. It allows archived/viewer
reads, never mutations. Existing source writes use the same project-first lock.
The browser hydrates immutable figures immediately under five-minute private asset
leases (60 outstanding per actor/project). Existing Storage membership policies,
cleanup checks and delete trigger honor the leases. Hydration releases them on
success/error/cancel; failed releases expire and are pruned on the next capture.
No manuscript or CRDT snapshot archive is stored by this operation.

SharedClient counts queued/acknowledged updates. A capture barrier targets edits at
the click, not every subsequent keystroke; remote state alone is not an ACK. Offline,
recovery, stale epoch, read-only pending work and timeout fail without dropping edits.
PaperPage reuses its warmed compiler and binds output to the captured files/bytes,
main and revision. Live writing reuses PDF/diagnostics/export without remounting
CodeMirror. Source export retains the compiled copy even after later saves/deletions.
This is a transient browser build snapshot, not a named submission checkpoint.

PaperNavigation now stacks PaperExplorer and PaperOutline with a resizable divider.
The existing draft-aware buildOutline parser retains source locations across linked
files; nestOutline groups headings by section level with stable repeated-title IDs.
Navigation retains the existing expected-source check before jumping. This is source
structure, not a compiled TeX table of contents. The sidebar mode row and project
search/replacement UI were removed on 2026-10-02; Explorer and outline stay stacked.

Live-writing presence includes the authenticated actor ID for avatar lookup. The
toolbar reuses the membership-checked project-avatar API and private signed image
URLs; it groups multiple device connections into one portrait per coauthor. Cursor
markers and avatar rings use the same gateway-assigned color. Presence includes
the recipient; the toolbar shows everyone while editor decorations skip local-user
cursors to avoid duplicating the native caret.

## Live-writing browser integration

PaperPage discovers enrolled files through membership-checked list_shared_paper_files;
legacy editing is disabled for those files. VITE_PAPER_SHARED_URL enables a lazy
Live writing dialog. Owner enrollment uses the displayed source version and refuses
stale seeds. Dialog owns one Y.Doc, Y.UndoManager and CodeMirror binding without
standalone history. Parent polling never replaces its document/connection.

SharedClient persists pending CRDT updates and the full local recovery checkpoint
in IndexedDB before transport sends. ACK clears only the batch it confirms; missing
ACK is retried idempotently. Reopening requires explicit recovery; epoch mismatch
does not merge. Web Locks serializes a user/project/file across local tabs. Account
change purges recovery; storage/limit/rejection failures retain download and freeze
writing. The dialog blocks sign-out with pending/recovered work and warns on close.

Cursors use Yjs relative positions, rendered as named CodeMirror decorations. Peer
identity/color come from the gateway's verified actor/profile, not client names.
Presence is ephemeral and gateway-local, checked on delivery and removed on close;
heartbeat detects dead peers. No optional follow mode yet. End shared session is
owner-only and CAS protected; unsent old-epoch edits require separate recovery.
The lifecycle section above completes shared history and retained causal archives for the local pilot.

## PAPER-13 socket transport (B1)

`server/coediting/websocket-server.mjs` attaches to an HTTP(S) server. Only the exact
`/paper-shared` path, explicit Origin allowlist and `scholaris-paper-v1` subprotocol
are accepted. Tokens travel in join/refresh frames, never URLs. Each socket binds
one verified user/file/epoch. B2 adds explicit owner-only version-checked start/end.
The CLI binds loopback by default and requires TLS for non-loopback addresses.

Protocol: join {token,file,epoch?} -> state {epoch,sequence,editable,state};
update {id,epoch,update} -> state when changed, then ack {id,epoch,sequence} after DB
commit, or rejected {id,code,message}. Binary CRDT values are base64. sync requests
an authorized checkpoint; refresh {token} requires the same verified user. Reconnect
must pass its previous epoch and retain pending updates until ack; stale epochs
close with 4409 and require separate recovery. Replaying committed Yjs updates is
idempotent. Full bounded checkpoints favor correctness over bandwidth in this pilot.

Each socket polls authorized durable state every two seconds, so other gateways'
commits and permission changes are observed without an unchecked room broadcast.
Client messages serialize with a bounded queue. Defaults: 50 connections, ten per
remote IP, 60 upgrades/IP/minute, 120 messages/user/minute per gateway, eight queued
operations/socket, 360000-byte input and approximately 3MB outbound backlog. Pings
detect lost peers. Production needs distributed quotas and measured fan-out costs.
At B1 delivery, UI/offline/presence was deferred; the later sections describe its
completed local implementation. Local tests use WS, not hosted WSS.

## PAPER-13 authenticated session slice

The server-only session service accepts a privileged Supabase client and explicit
project allowlist (empty by default). Auth.getUser verifies tokens on each operation.
Service-only RPC paper_shared_session locks project then file/state, rechecks current
verified membership/status, and atomically commits a bounded Yjs checkpoint and
materialized paper_files text. Existing quotas, version clock, revision trigger and
history remain authoritative. CAS sequence retries merge competing gateway writes
onto fresh DB state; no process-local room lease/cache is authoritative.

Owner enrollment captures safety history and checks seed source version/content.
A table trigger fences legacy updates/deletes, including manifests/restores. Disable
keeps materialized text/history and removes active CRDT state; reenrollment assigns
a new epoch. The completion section above now provides retained causal archives
and coordinated lifecycle; real-browser/hosted acceptance remains a beta gate. This is a direct service, not a public HTTP/WebSocket endpoint.

Validation runs in disposable Node workers: 3s deadline, 64MiB old/16MiB young heap,
2MiB stack, 256KiB update, 512KiB text, 2MiB state; eight pending validators per
service instance. These are not complete process/container resource limits.
The B1 transport above adds sockets and TLS configuration. Distributed rate controls,
browser/offline binding, presence and immutable multi-file snapshots remain later slices.

## Empty Paper manifests and simplified file management

FileManager retains atomic revision-checked manifest writes and private-figure
cleanup/history protections. File rows replace the select list; non-colliding
uploads merge into local staged entries, conflict/skipped-file review remains.
Save changes is the only persistence action. Empty manifests are allowed; an empty
main_file is valid only when no .tex source exists. History capture includes [] so
restores can preserve an empty current state and empty snapshots can be restored.
Empty-workspace history/upload actions remain accessible. Two 20261001 migrations
replace private validators/capture functions; no RLS or permission relaxation.

## PAPER-12 bounded coediting prototype

`scripts/coediting/gateway.mjs` is an executable single-project model, not an API.
Signed fixture identities -> per-operation role check -> clone Yjs candidate ->
validate source/limits -> atomic local persisted state -> revision acknowledgement.
The test injects dropped ACKs, duplicates, reordering and disconnected client edits.
One stable file ID maps to a source Y.Text and epoch. Rename preserves that identity;
restore resets state and increments epoch; delete tombstones it. Old epochs cannot
resurrect deleted/replaced text. Failed writes retain the client's unsent queue.

`fixture-auth.mjs` signs test identities; it does NOT verify Supabase sessions.
`restart-probe.mjs` is a separate child process which rehydrates disk-only state.
Snapshots materialize all current text at one model revision. This tests source
consistency, not actual compile/export/history integration or private asset hydration.
The CodeMirror binding passes state construction; DOM selection/IME is untested.
All fixtures use temporary generated manuscripts, never real user data.

### Proposed integration contract and rollout slices

1. Local integration gate: trusted gateway validates real Supabase tokens (signature,
   issuer, audience, expiry and verified account) and queries authoritative membership.
   Use WSS, explicit origin allowlist and private rooms. Never trust client role,
   user ID, project ownership or awareness name. Verify two actual accounts before beta.
2. Durable model: project protocol version and revision; stable file ID/generation;
   Yjs checkpoint + append-only accepted updates with unique update IDs/sequences.
   Project lock precedes document lock, matching existing paper mutations. Validate
   candidates in isolated bounded workers, recheck access under DB transaction,
   commit before ACK/fan-out. Serialize each room; fence stale gateway owners so two
   processes cannot acknowledge divergent DB state. Test crash before/after ACK.
3. Migration transaction: pause editors, drain acknowledged legacy saves, preserve a
   history checkpoint, seed each file ONCE from current persisted content, switch
   project protocol under lock. Update save_paper_file, apply_paper_manifest,
   restore/history, rename/delete/import and any direct table write policies to
   enforce the protocol. An old tab receives an explicit upgrade/reload error.
   No blind fallback to whole-file writes. Preserve recovery drafts for comparison.
4. Browser slice: bind Y.Text to CodeMirror, replace standalone undo with Yjs history,
   persist pending updates by user/project/file/epoch, reconcile on reconnect, display
   unsent/syncing/saved honestly. Do not append a second copy of initial text. Keep
   rejected local work exportable; logout/access loss closes rooms and clears private
   session caches according to recovery policy. Revocation cannot erase text already
   downloaded, but must prevent all future reads/writes and presence delivery.
5. Lifecycle/snapshot slice: rename changes manifest path only; delete/restore fences
   old epochs and requires stale clients to recover separately. All project mutations
   advance a revision. Compile/export/checkpoint take an immutable DB snapshot with
   exact file generations, text, main file and immutable binary references; compile
   uses that manifest even if edits continue. Restart/disconnect never implies Saved.
6. Presence slice: authorized expiring ephemeral heartbeat/cursor state, no durable
   manuscript authority. Debounce and bound payloads; idle disconnect timeout, no
   fake online member avatars. New permissions take effect on open sessions.
7. Controlled beta: two then five real accounts, mobile/IME/keyboard/undo, offline
   refresh, dropped/reordered traffic, revoked sessions, multi-process restart,
   import/restore conflicts, coherent actual PDF/ZIP/history and load soak. Set host
   budget and operational ownership before enabling shared rooms.

Rollback: stop new shared writes, drain committed updates, materialize one checkpoint
under project lock, increase protocol/generation and publish a legacy baseline.
Keep CRDT log/checkpoints and recovery drafts until accepted recovery/retention ends.
Force old clients to reload; never merge old-epoch queues silently into the baseline.

Prototype limits: 256 KiB/update, 512 KiB UTF-8 source, 2 MiB encoded room state,
120 operations/user/minute. These are test bounds, not production quota changes.
Single-process synchronous file replacement does not prove distributed transactions,
power-loss filesystem durability, bounded hostile decode CPU, network latency,
Supabase authorization or browser binding behavior. Production gate remains closed.

## Recompile preparation and BibTeX deduplication

After saving drafts, fresh access metadata and the revision-bracketed manifest read
run concurrently and both settle. Access failure has priority before using source.
BibTeX memoization is scoped to one clean build: main entry, all local aux citation/
database/style/input directives, bib/bst contents and unchanged bbl must match.
Bounded inputs/output (4 MiB) and successful completion are required. Warnings are
replayed; failed/unreadable states run normally. No cross-job generated-file cache.


## Equation composer

SourceEditor lazy-loads EquationDialog and KaTeX only when opened. A 200ms preview
uses local bundled fonts and HTML+MathML. equations.ts handles delimiters, source
wrapping, label checks, package setup and isolated CodeMirror insertion. Captured
source/range rejects stale edits. Explicit amsmath setup uses a separate editor
transaction for the active main file or the existing draft store for another main
file; both retain normal autosave/version protection. No backend/schema changes.


## PAPER-11 asset organization

asset-tools plans source-preserving literal path edits and import conflict choices.
All compiler paths are project-root relative. FileManager stages reviewed entries
and commits through existing applyPaperTree revision/history authorization.
FigurePicker inserts an undoable source snippet; private FigurePreview hydration
is reused. Starter manifests are original local source, with no remote templates.


## PAPER-10 reference assistance

references.ts provides an offset-preserving BibTeX reader and literal TeX key
scanner over authorized current drafts. Field/key edits patch known spans; imports
retain raw entries/declarations. No BibTeX-to-JSON reserialization. Strings, macros,
conditionals and active bibliography reachability are not evaluated.

ReferencePicker and completion integrate with SourceEditor; insertion is one
isolated CodeMirror undo transaction. ReferenceManager loads a revision-bracketed
saved manifest, stages changes/diffs, and uses applyPaperTree/apply_paper_manifest.
Existing permissions, quotas, revision protection and history apply; refreshing
reconciles the established draft store. No schema or dependency changes.

Import limits: 512 KiB and 100 previewed entries. Lists/pickers show 150 results
with search narrowing. Conflicting @string declarations require source repair.
Rename warnings include unhandled key occurrences and BibTeX dependency fields.
No DOI provider is contacted.

## Compilation performance follow-up

Each mounted user/project workspace owns a CompilerSession. Engine warm-up starts
on mount; successful compiles retain the engine and its public package filesystem.
Before every job, a verified reset removes all files/folders under /work, then
uploads the full current source manifest. Failures, cancellation, timeout, leaving
the workspace or detected access loss terminate the worker. Standalone compiler
calls retain their fresh-worker lifecycle for scripts/tests. No concurrent leases.

The worker loads a best-effort IndexedDB cache of public package responses before
engine initialization (1.5-second cache-read budget). It stores only responses from
the allowlisted TeX package endpoint, never source, figures or generated outputs.
Limits: 64 MiB / 2,048 entries total, 32 MiB per response; positive entries expire
in seven days, missing public packages in one day. Network errors are not cached.
The ~10 MB format fits the entry limit. Cache failure falls back to normal fetching.

After each pass, compare generated aux/bbl/toc/out and related reference files;
stop when unchanged and no rerun warning remains, with the existing three-pass cap.
Workspace-only figure caching uses immutable Storage paths, is capped at 25 MiB,
prunes removed references and clears on unmount/access loss. Every compile still
saves drafts and reloads authorized project/source state before cache use.


## PAPER-09: continuous PDF reader

PdfPreview loads per-page geometry once, lays out a continuous document and mounts
only visible pages plus neighbours (maximum 12). PdfPageSurface owns each cancellable
canvas, PDF.js TextLayer and allowlisted link overlay. Bitmaps cap their long edge
at 2048px; thumbnail navigation mounts at most five small canvases. Unmounted pages
release bitmaps after render cancellation; replaced PDF loading tasks are destroyed.
Page/fraction anchors restore across scale, resize and document changes. Search
scans text sequentially and caps results at 1,000 occurrences. UI results/selections
are bound to the actual PDF bytes. Metadata/search still depend on document size;
only rendering memory is bounded, not total PDF.js worker memory.

Real engine probing found no SyncTeX primitive/output. Source-to-PDF uses selection
or current-line literal search. Live PDF-to-source uses current-file text matching;
the ordinary viewer no longer opens project search.
Both require a current compiled source signature. No guessed coordinate mapping.


## PAPER-08: source navigation and editing

PaperNavigation indexes current draft text through pure editor-tools helpers.
Literal input/include traversal is cycle-safe; dynamic TeX is not evaluated.
Outline navigation carries source offsets and expected content, rejecting stale jumps.
SourceEditor uses CodeMirror compartments for theme/preferences, retaining history.
The old project-search/replacement dialog is no longer mounted by PaperPage.
Editor Find & replace remains local to CodeMirror; manifest utilities remain for
references/file operations with their existing revision and permission checks.
No separate draft store, SQL migration or dependency is introduced. Preferences
are version-tolerant, bounded local settings keyed by user, with no source content.


## PAPER-07: compiler contract

PaperPage captures the saved manifest/main-file revision, hydrates figures with an
AbortSignal and acquires a clean workspace compiler job. A three-minute preparation/job
deadline complements the two-minute engine timeout. Cancelling a compile stops
waiting for draft saves without aborting the draft store's durable save operation.
Only the current uncancelled job may publish output. PDF output retains its source
signature, revision and main file; edits mark it stale rather than discard it.

`compile-diagnostics.ts` groups recognized engine messages and resolves only
reported project-file locations. `CompileDiagnostics.tsx` exposes repairs, source
navigation and raw logs. Stale diagnostics cannot jump to outdated lines. The
worker adapter reports dependency network failures without receiving auth tokens.
Verified workspace resets isolate auxiliary files; no project-output caching is used.


## PAPER-06: manuscript history

`HistoryPanel.tsx` presents history; `history-api.ts` owns RPC access and
`history-diff.ts` compares stable identities and source blocks. Server-authored
`paper_history` snapshots retain source, file tree, main-file selection and private
figure references. Public mutation RPCs wrap private validated implementations and
capture history under the project lock. `paper_file_version_clock` prevents a
deleted/restored identity from reusing a version held by a stale client.

Restore requires the previewed workspace revision and creates a protected safety
checkpoint before applying an atomic manifest. Readers use authorized list/detail
RPCs; direct history table access is revoked. Figure cleanup checks both live and
historical references, with a database deletion guard as well as Storage policies.


## Runtime and responsibilities

Team Scholaris is a React/TypeScript SPA built by Vite, styled with Tailwind CSS
and the existing CSS system, and routed with React Router. Supabase provides
Auth, PostgreSQL, private Storage, Realtime, and Edge Functions. There is no
Next.js runtime or separate Express server. Exact dependency versions live in
[package.json](../package.json) and its lockfile.

```text
Browser: React routes / feature components
  ├─ feature *-api.ts → typed Supabase client
  │   ├─ Auth → session / verified identity
  │   ├─ PostgREST / RPC → PostgreSQL grants, RLS, trusted functions
  │   ├─ Storage → private project files and paper figures
  │   └─ Realtime → authorized chat reconciliation
  ├─ Edge Functions → invitation email; paused Google Calendar integration
  └─ Paper → CodeMirror → isolated pdfTeX WASM worker → PDF.js / local export
```

Route protection controls navigation; database policies and trusted backend
functions authorize data access. A browser session is not permission to bypass
current project membership, archive state, revision checks, or quota enforcement.

## Repository structure

```text
team-scholaris/
├── docs/                   # Seven canonical product/engineering documents
├── .cursor/rules/          # Scoped adapters to root RULES.md
├── src/
│   ├── app/                # Router and route status pages
│   ├── components/layout/  # AppShell and ProjectTabShell
│   ├── features/
│   │   ├── auth/           # Session provider, auth screens and navigation
│   │   ├── projects/       # Dashboard, project creation and Overview
│   │   ├── invitations/    # Invite and pending-acceptance UI/API
│   │   ├── team/           # Membership management
│   │   ├── paper/          # Editor, file tree, compile, preview, import/export
│   │   ├── files/          # General research files
│   │   ├── chat/           # Persistent realtime discussion
│   │   ├── tasks/          # Task list, mutations and types
│   │   ├── activity/       # Timeline, shared renderer and queries
│   │   ├── meetings/       # Scheduling and paused Google connection UI/API
│   │   └── settings/       # Owner management, confirmation dialogs and Trash
│   ├── lib/                # Environment validation, Supabase client, constants
│   ├── types/database.ts   # Database contract consumed by the frontend
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   ├── config.toml
│   ├── migrations/         # Ordered schema, grants, policies, triggers and RPCs
│   └── functions/
│       ├── send-project-invitation/
│       ├── google-calendar/
│       ├── runtime.d.ts
│       └── .env.example
├── public/vendor/swiftlatex/ # Vendored compiler and license/NOTICE files
├── scripts/                # Existing Node test harnesses and worker adapter
├── README.md
├── RULES.md
├── task.md                 # Only build tracker
├── .env.example
└── .gitignore
```

Settings now lives in `features/settings/`. Tests remain in `scripts/`;
do not invent parallel `services/`, `utils/`, or `tests/` layers merely to match
a generic scaffold. Feature API modules already provide the data boundary.

## Routes and layout

Public auth routes are `/login`, `/register`, `/forgot-password`, and
`/auth/callback`; `/` redirects to login. Protected routes include
`/reset-password`, `/app`, and `/project/:projectId` with child destinations
`paper`, `files`, `team`, `chat`, `tasks`, `activity`, `meetings`, and `settings`.
Dashboard Trash uses `/app?view=trash`.

`AppShell` contains application navigation. `ProjectTabShell` supplies the shared
project header, status, back link, and tabs. Paper has an independent full-width
workspace under the application shell. Feature workspaces are lazy loaded where
configured in [router.tsx](../src/app/router.tsx). Settings uses the shared shell.

## Data model

| Table/group | Responsibility and relationships |
| --- | --- |
| `profiles` | Profile identity keyed to `auth.users`; Auth owns credentials |
| `projects` | Owner, name, description, active/archived status, soft-delete marker |
| `project_members` | Project/user membership, access level, descriptive research role; exactly one owner |
| `project_invitations` | Hashed tokens, intended email/access, expiry, acceptance/revocation |
| `paper_workspaces`, `paper_files` | One workspace per project, main path, manifest revision, text/figure/folder entries and versioned content |
| `project_files` | General file metadata and private Storage object references |
| `project_messages` | Project/channel text messages and sender attribution |
| `project_tasks` | Assignments, priority/status/due date, revision, completion and soft deletion |
| `activity_events` | Transactional, visibility-scoped metadata history |
| `project_meetings` | Organizer, UTC schedule/zone, attendees, link, notes, revision and provider state |
| `project_settings_operations` | Backend-only caller/operation receipts with request digest and minimal outcome |
| `google_calendar_connections`, `google_calendar_oauth_states`, `google_calendar_operations` | Server-only integration credentials, authorization state and retry coordination |

Apply migrations in filename order. Earlier definitions may be superseded by
later review migrations; reading only the first migration is not sufficient.
The current sequence ends with `20260926000100_project_settings.sql`, applied
locally for SETTINGS-01. Hosted migration parity remains unverified.

Settings has a dedicated revision advanced by a trigger on changes to managed
project fields. Owner-only RPCs handle details, archive state, transfer, Trash and
restore. A private implementation function is reachable only through fixed-action
wrappers. Mutations lock their operation ID, then affected users' quota keys in
sorted order, then the project. Quota keys match project creation. Retries with
the same caller, operation and request digest return a minimal receipt even after
transfer or deletion changes access. No-op saves do not change revision/history.

Trash has a separate paginated owner-only metadata RPC; ordinary project RLS is
unchanged. Recovery is authorized server-side within 30 days and against the owned
quota. Restore returns archived content and retained memberships. Pending invites
are revoked on transfer/deletion and are never resurrected by restoration.

## Data access, consistency and activity

- Keep queries/mutations in feature `*-api.ts` modules, with reusable environment
  and client setup in `src/lib/`. UI owns presentation and draft state.
- Sensitive multi-row changes use narrow PostgreSQL RPCs with explicit caller
  checks, fixed search paths, restricted execution, and transactional updates.
  Not every table is SELECT-only: Files and Chat have deliberately constrained
  direct operations. Preserve their column grants and RLS.
- Project mutations serialize around the project row. Project creation also
  locks the user's quota. New lifecycle operations must reconcile lock order
  rather than introducing races or deadlocks.
- Paper saves compare file versions; manifest changes compare workspace
  revisions. Tasks and Meetings use expected revisions and stable creation IDs.
  Conflicts preserve drafts. Repeated identical requests must not duplicate work.
- Cancel/ignore obsolete requests, refresh on focus where implemented, and do
  not replace an open edited form with a background snapshot.
- Chat subscribes to Postgres changes, then reconciles authorized snapshots on
  connection, change, reconnect, refresh, and focus. Membership is not presence.
- Activity is written by trusted database triggers in the same transaction as
  the change. Its `(created_at, id)` cursor supports stable pages. Invitation
  events are owner-only; payloads omit content bodies and secrets. Paper manifest
  operations emit at most one workspace event per transaction. Earlier untracked
  actions are not backfilled. Overview uses the same event stream.

## Paper compilation and exports

CodeMirror 6 edits one selected source. Explicit save persists through the paper
API. A fresh SwiftLaTeX/pdfTeX WebAssembly worker receives a bounded source/figure
snapshot, without Supabase credentials. It performs LaTeX/BibTeX passes and
returns PDF bytes and bounded logs. Nested main files use a worker-only root
entry. Workspace file lookups must not silently fetch private filenames remotely.

Runtime TeX packages/fonts may be fetched from `https://texlive.texlyre.org`.
The browser therefore needs network access for uncached packages. The mirror
receives package requests and network metadata, not an intentional paper upload.
Vendored compiler licensing and attribution remain in
`public/vendor/swiftlatex/NOTICE.txt` and accompanying files.

Compilation has timeout/cancellation and size limits; PDF.js renders the last
successful output with page/zoom controls and accessible extracted text. Failed
compilation retains that output and indicates staleness. ZIP import runs in a
worker with compressed/decompressed limits and explicit replacement decisions.
Exports capture a snapshot, include sources/figures as applicable, clean up blob
URLs, and never implicitly save to the database. This is not CRDT coediting.

## Storage and external services

Private Supabase buckets `project-files` and `paper-figures` store binaries.
Authorization depends on current membership and committed object references.
Metadata registration validates object path/ownership/size; referenced objects
cannot be deleted directly. Removing metadata and deleting a binary are separate
steps, so interrupted cleanup can leave an orphan and must be reported.

Invitation email uses an authenticated Edge Function and caller-scoped RPCs.
Local delivery goes to Mailpit; a hosted Resend adapter is available through
backend secrets. It is not a general notification service.

Google Calendar integration is implemented but paused. Its Edge Function handles
authorization-code exchange with PKCE and browser-bound state, encrypted refresh
tokens, and organizer-owned primary-calendar events with Meet conference data.
Stable event IDs, operation leases and provider ETags support reconciliation.
Only the original connected organizer can synchronize their Google event;
project-owner authority does not grant another user's OAuth authority. Title,
time and agenda may be exported; shared notes and attendee invitations are not.
There is no automatic import of changes made directly in Google Calendar.

## Environment and deployment

Local ports/setup are in [README](../README.md). The frontend reads only public
`VITE_` configuration; backend secrets use the separate function environment.
Frontend validation accepts hosted publishable keys and local/legacy anon JWTs;
it is not a JWT signature verifier.

Local callback identities are distinct:

| Purpose | Callback |
| --- | --- |
| Supabase Google sign-in provider | `http://127.0.0.1:54321/auth/v1/callback` |
| Application auth completion | `http://127.0.0.1:5173/auth/callback` |
| Calendar integration | `http://127.0.0.1:54321/functions/v1/google-calendar/callback` |

Calendar secrets are `GOOGLE_CALENDAR_CLIENT_ID`,
`GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, and
`GOOGLE_CALENDAR_TOKEN_KEY` (32 random bytes represented by 64 hex characters).
The token encryption key must remain stable unless tokens are deliberately
migrated or connections invalidated. `APP_ORIGIN` must match the browser origin.
The callback is configured in code; that does not mean its browser flow works.
The known gateway preflight issue is recorded in [MEMORY](MEMORY.md).

A hosted Supabase project exists. Full hosted migration parity, frontend hosting,
production callback configuration and release readiness are not established.
Deployment needs SPA fallback routing, compiler static assets/MIME handling,
Auth allowlists, backend secrets and a reviewed migration plan. Use explicit
target selection; never assume local application of SQL changes hosted state.

## Account profile implementation

`src/features/profile` owns the profile editor, avatar artwork, API and provider.
AppShell mounts a user-keyed provider; `/profile` is a protected lazy route.
`save_account_profile` validates and serializes updates using expected timestamps;
username generation/backfill and uniqueness are enforced by PostgreSQL.
Private `profile-avatars` stores immutable WebP uploads; the browser re-encodes
photos to 512px squares. `get_project_avatars` exposes only current member IDs,
preset numbers and saved paths after project authorization. Chat obtains signed
photo URLs in a batch and reuses ProfileAvatar, without reading private profiles.
