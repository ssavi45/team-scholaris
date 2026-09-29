# Architecture

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
or current-line literal search; PDF-to-source uses selected-text project search.
Both require a current compiled source signature. No guessed coordinate mapping.


## PAPER-08: source navigation and editing

PaperNavigation indexes current draft text through pure editor-tools helpers.
Literal input/include traversal is cycle-safe; dynamic TeX is not evaluated.
Search results carry source offsets and expected content, rejecting stale jumps.
SourceEditor uses CodeMirror compartments for theme/preferences, retaining history.
ReplaceProjectDialog loads a coherent saved manifest and previews literal changes;
applyPaperTree submits that original revision to the existing atomic manifest RPC.
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
