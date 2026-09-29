# Architecture and product decisions

## Reuse engine/packages, reset document state

Supersedes the earlier fresh-worker-per-click choice for the interactive workspace.
Keep a workspace-owned engine ready and cache public package responses across visits.
Always clear and verify /work before a new job; do not retain auxiliary output or
reuse PDFs across different source snapshots. Adaptive passes use actual generated
reference state rather than scanning source commands. Cancellation/errors retire
the engine. Retain a user-facing Restart compiler and rebuild recovery action.


## PAPER-09: continuous local rendering and honest source lookup

Use the existing PDF.js dependency for virtualized continuous pages, text layers,
links and bookmarks; do not add a second viewer or change the compiler. Preserve
page/fraction reading anchors rather than absolute pixels across recompiles.
The 2026-09-29 real nested-main/include/BibTeX probe found no SyncTeX primitive or
artifact. Ship literal text lookup with stale-output guards; defer exact coordinate
mapping until engine support exists. Defer the optional separate preview window
until authentication/revocation, update and memory lifecycle are accepted.


## PAPER-08: reuse the editor and atomic manifest boundary

Use the existing CodeMirror editor/history and draft store for navigation, snippets
and preferences. Use literal source search and a conservative include outline,
with explicit limitations rather than pretending to parse all TeX. Multi-file
replacement reuses the revision-checked manifest transaction and history capture;
there is no second bulk-write path or new schema. Preferences stay on the device
and are scoped by user; manuscript content is not part of preference storage.


## PAPER-07: isolated manual compilation and conservative diagnostics (adopted)

Preserve pdfLaTeX/BibTeX compilation with clean document state (engine reuse now supersedes per-click worker recreation). Clean rebuild is explicit but
every compile already starts with fresh auxiliary files. Only public package
downloads may benefit from network/browser caching. No project data or generated
auxiliary file is shared across worker jobs. Show reported source locations only;
fall back to raw context when logs are ambiguous and disable links after edits.
Optional compile-on-save stays deferred until manual acceptance of this path.
Do not add XeLaTeX/LuaLaTeX/Biber, system fonts or a server compile farm implicitly.


## PAPER-06: bounded server-authored history (adopted)

Capture full validated manifests inside trusted mutations, with stable file IDs
and immutable figure references. Keep text snapshots at most every five minutes,
plus before/after tree changes. Retain up to 24 automatic snapshots for seven days,
pruned on new capture; inactivity does not run a background prune. Keep up to 20
named/safety checkpoints until explicit deletion. Quotas are 50 MiB snapshot JSON
and 100 MiB distinct live/historical figure bytes. Protected snapshots are never
silently evicted. Explicit mutations fail safely if a required capture cannot fit;
ordinary text autosaves may skip automatic capture when protected history fills up.

Restore is a new, revision-checked atomic manifest with mandatory pre-restore
safety capture. A persistent file-version ledger prevents stale-client version
reuse after delete/restore, even after history pruning. This provides recoverable
writing without pretending to implement real-time collaborative editing.


These records preserve the reasons behind the current direction. Status describes
a decision, not a test result. Current execution state belongs in
[MEMORY.md](MEMORY.md); the only build checklist is [task.md](../task.md).
This consolidation is dated 2026-09-26; earlier decisions are reconstructed from
the original brief, subsequent instructions, source and previous build notes.

## ADR-001 — React SPA and managed Supabase (adopted)

Use React, TypeScript, Vite, React Router and Supabase Auth/PostgreSQL/Storage/
Realtime/Edge Functions. These are the existing implementation and support local
development without introducing a second general-purpose backend. Keep backend
authorization in RLS and trusted operations. Do not migrate to Next.js or add
Express solely because a generic project template uses them.

## ADR-002 — Local-first, cost-conscious increments (adopted)

Use Docker-backed local Supabase and optional hosted development, with explicit
environment separation. Prefer browser computation and managed services within
early free-tier constraints. Open source alone is not a reason to self-host a
service. No production frontend provider has been selected. Apply small,
reviewable increments; preserve unrelated local work and real research data.

## ADR-003 — One owner and fixed access levels (adopted)

Each project has exactly one owner and owner/member/viewer access. Research-role
labels are descriptive. Five retained owned projects is the early-beta limit;
archived projects count and joined projects do not. Backend constraints and
transactional operations enforce these invariants; UI constants are not security.

## ADR-004 — Browser-safe Supabase credentials (adopted)

Support both hosted publishable credentials and legacy/local anon JWTs under
`VITE_SUPABASE_PUBLISHABLE_KEY`. Do not require only the `sb_publishable_` format.
Reject privileged credentials in frontend configuration. Client validation
detects misconfiguration; the backend verifies tokens and grants access.

## ADR-005 — Scholaris-native paper workspace (adopted)

Use CodeMirror 6, vendored SwiftLaTeX/pdfTeX WebAssembly, PDF.js and client-side ZIP
tools. Do not self-host Overleaf Community Edition. This keeps compilation in the
browser and avoids a public untrusted server compilation service. The tradeoffs
include bounded resources, pdfTeX/package compatibility limits, and external
runtime package availability.

Build the reliable single-user save/compile/preview/export/import workflow before
realtime paper collaboration. Current explicit saves and revision conflicts are
not Yjs/CRDT editing. Persistent shared-document state, reconnect recovery and
file-tree coordination require a separate future design.

## ADR-006 — Separate paper assets and general files (adopted)

One paper workspace has a source/folder tree and bounded figures. General research
Files is a flat repository with separate quotas. Both currently use private
Supabase Storage for binaries, not Cloudflare R2. R2 was exploratory in the brief
and remains unimplemented; do not introduce it without an authorized build.

## ADR-007 — Shared project shell, full-width Paper (adopted)

All ordinary project tabs use ProjectTabShell for consistent navigation and
header treatment. Paper uses an independent edge-to-edge editing workspace.
Ordinary forms/cards can retain sensible reading widths. Use the implemented
green/serif scholarly visual language and existing Lucide icons.

## ADR-008 — Preserve current chat behavior (retained; policy follow-up)

The original brief specified one chat and allowed viewers to participate. Later
local work introduced channels, and current RLS/UI/tests make viewers read-only.
The September review retained those changes. Do not silently enable viewer writes
or remove channels while doing unrelated work. Confirm the viewer participation
policy before broader beta rollout. No read receipts or presence system exists.

## ADR-009 — Transactional history and conflict-aware writes (adopted)

Trusted database triggers create durable Activity metadata with the mutation.
Invitation events are owner-only; content bodies and secrets are omitted.
Use revisions and retry identities where implemented, preserve drafts on conflict,
and deduplicate manifest-level paper events. Do not generate parallel client-side
history or invent past actions that were never recorded.

## ADR-010 — Tasks and meetings added by later user direction (adopted)

Although originally deferred from V0.1, TASK-01, ACTIVITY-01 and MEETINGS-01 were
explicitly requested and built. Meetings begin with schedules and external links;
the app does not host video. Task boards, broad notification services, recurring
meetings and realtime note coediting were not included in those requests.

## ADR-011 — Google Meet through organizer Calendar OAuth (implementation paused)

Use Google Calendar event conference creation for instant and scheduled Meet
links. This creates an organizer-owned calendar event even for Start now.
Authorization is separate from Supabase Google sign-in. Backend-only tokens,
browser-bound state, narrow scopes, stable event IDs and reconciliation protect
the boundary between local records and Google. No Google attendee invitations
or shared research notes are sent. The user paused this work on 2026-09-26 after
an unresolved local connection failure; it is not a completed integration.

## ADR-012 — Recoverable lifecycle management (implemented; acceptance pending)

SETTINGS-01 adds owner-managed details, archive/unarchive, immediate transfer
to an eligible current member, and owner-only Trash recovery. Restore is
server-authorized within 30 days and return an archived project with retained
membership. Pending invitations stay revoked. No automatic purge is included;
expiry of self-service recovery must not be described as physical data erasure.
The implementation uses a dedicated settings revision, quota locks compatible
with project creation, and backend-only operation receipts bound to caller and
request digest. These permit safe retries after ownership/access changes. SQL
was applied locally; the root tracker retains the pending manual acceptance.

## ADR-013 — Canonical documentation and one task tracker (adopted)

Replace per-build Markdown in docs with PRD, ARCHITECTURE, DESIGN, TEST_PLAN,
SECURITY, DECISIONS and MEMORY. Keep the only task checklist at root `task.md`.
Use root RULES.md as the contributor/AI rulebook, with concise Cursor adapters.
Update durable decisions when direction changes and current memory after each
build; do not create another competing next-build or feature-task document.

## PROFILE-01: Separate private profile details from shared avatars

Keep the existing profiles table and name-based team identity. A personal
username/email preference affects only the navbar badge. Private immutable
Storage objects support uploaded photos; a narrow project-authorized RPC exposes
saved avatar presentation to teammates without broadening profile-row reads.
Use ten original SVG artwork presets and the same renderer across navbar/chat.
