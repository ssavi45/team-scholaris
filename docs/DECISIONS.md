# Architecture and product decisions

## PAPER-13 lifecycle decision - 2026-10-02

Preserve live identity and causal state through unchanged-source renames. Destructive
file changes require owner consent and a safety checkpoint; restore ends affected
sessions and seeds a new epoch only on explicit enrollment. Do not reuse old causal
queues in a restored manuscript. Keep causal checkpoints with source history and
charge their bytes to the existing retention quota; no unbounded second archive.

Use short private database presence leases and shared per-actor rate counters for
the pilot's independent gateways. Keep process/IP/queue/payload guards. Optional
avatar following only scrolls, never changes the local selection. Hosting/provider,
public rollout and real-browser acceptance remain separate release decisions.

## PAPER-13 D1: short locked saved cuts, transient build artifacts

Use a membership-checked PostgreSQL capture with the same project-first lock as
source mutations. Wait only for the initiating author's edits queued at the click;
compile saved materialized text rather than pausing all writers or reading live
Y.Text midway through a build. Brief asset leases bridge SQL and private Storage;
eager hydration permits export after later file changes. Keep exact successful
build sources alongside PDF in workspace memory and reuse the warmed engine.
No per-keystroke compile, new compiler dependency or durable submission archive.
Coordinated history/CRDT rollback remains a separate PAPER-13 slice.

## PAPER-13 B1: authorized checkpoint delivery over sockets

Use ws for a separate Node transport; keep the existing browser app unchanged until
its offline/editor slice is ready. Pilot delivery polls durable authorized state per
connection, including writes from another gateway, instead of trusting an in-memory
room broadcast. This favors authorization and cross-instance correctness over low
latency/bandwidth. Revisit polling cost and distributed quotas before public rollout.
TLS is required by the CLI outside loopback. No host or deployment was selected.

## PAPER-13 slice A: PostgreSQL checkpoint CAS

For the non-public local slice, persist the full bounded Yjs checkpoint and source
text atomically. Competing gateways compare sequence and retry merging fresh state;
no process owns durable authority. This replaces the prototype's local disk write.
The initial A slice deferred retained archives and fan-out; later slices above
now deliver those for the pilot. Full checkpoint CAS remains the durable protocol. No transport host or production rollout is selected.

## PAPER-12: coediting decision gate — 2026-10-01

Status: bounded local proof delivered; production rollout NOT accepted yet.
Select Yjs 13.6.33 + y-codemirror.next 0.3.6 for further integration, as development
dependencies only. No coediting code is imported by the application. Keep existing
versioned saves authoritative until the migration gate passes.

| Candidate | Merge/recovery | Infrastructure and operating cost | Decision |
| --- | --- | --- | --- |
| Current versioned whole-file saves | Rejects conflicting writes; users reconcile manually | Existing Supabase; lowest added operations | Retain until migration; not simultaneous writing |
| Yjs + trusted persistent WebSocket gateway | Incremental convergence and local-origin undo; needs durable sync protocol | Adds an always-running service, DB update/checkpoint storage, monitoring and egress | Recommended production topology, subject to hosting/budget selection |
| Yjs + client-to-client Broadcast alone | Merges delivered updates; no authoritative durable ACK | Existing Realtime but still requires trusted persistence and revocation enforcement | Reject as sole source of truth |
| Managed collaboration provider | May reduce transport operations; requires evaluating auth, retention, export and residency | Vendor subscription/usage cost, no provider selected | Revisit if self-hosted operations are unsuitable |

Use one room per stable file ID and document generation, not path. Trusted gateway
checks verified identity/current membership/active project on writes and access on
reads. Shared documents must reject every old whole-file mutation path server-side.
Never combine CodeMirror's standalone history with Yjs undo for the same document.
The existing Undo/Redo toolbar must call the active protocol's history adapter.

Transport recommendation is an engineering inference, not a purchased service.
[Yjs updates](https://docs.yjs.dev/api/document-updates) tolerate duplicate/reordered
delivery; [UndoManager](https://docs.yjs.dev/api/undo-manager) scopes undo by origin.
[CodeMirror binding](https://github.com/yjs/y-codemirror.next) provides the editor adapter.
[Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
checks channel admission; it is not our durable write transaction. Hosted
[Edge Function limits](https://supabase.com/docs/guides/functions/limits) make a
long-lived authoritative room a separate operational decision. Reviewed 2026-10-01.

Budget gate: no recurring spend introduced by this prototype. Before rollout, price
gateway baseline compute + peak room memory + database writes/storage/backups +
fan-out egress + monitoring. For N editors batching U updates/second of mean B bytes,
room ingress is N*U*B and peer fan-out roughly N*(N-1)*U*B bytes/second, excluding
protocol overhead/reconnect/checkpoints. Full-state rewrite per update is a proof
mechanism only; production needs compacted checkpoints + bounded append log.
No dollar estimate or free-tier viability claimed without provider/load selection.

Local proof is positive; hosted security and operational feasibility remain open.
PAPER-13 must begin with the integration gates in ARCHITECTURE, not enable a feature
flag against this fixture gateway. No migrations, paid services or deployment here.

## Reduce recompile waits without weakening snapshot checks

Overlap independent authorization metadata and coherent source reads; retain the
before/files/after revision bracket and save-before-compile contract. Deduplicate
only unchanged BibTeX work within a build, preserving logs and required LaTeX passes.
Do not trade stale citations or cached private output for faster timings.


## Equation preview renderer

Choose lazy-loaded KaTeX 0.18.9 for the bounded, local equation composer. MathJax
was considered for broader TeX extension support; this slice needs a focused math
preview rather than a second document engine. Unsupported/custom macros retain
an explicit source-insertion path and use the existing compiler for final output.
KaTeX preview numbering is not presented as final manuscript numbering. Renderer
options follow https://katex.org/docs/options; compatibility follows
https://katex.org/docs/supported. No runtime CDN or external equation lookup.


## PAPER-11: reuse manifest transactions and explicit import review

Retain the existing atomic revision/history write contract; no parallel asset
mutation API or schema. Literal path repairs use the compiler's project-root
working directory and flag unsupported TeX constructs. Starter templates merge
through reviewed imports, retaining unrelated files. General Files copying stays
optional/deferred; no implicit links to mutable project uploads.


## PAPER-10: preserve source and reuse atomic manifests

Reference forms patch source spans rather than normalizing BibTeX, preserving
unfamiliar fields and formatting. Multi-file renames/imports use the established
revision-checked manifest RPC/history instead of a separate citation database or
partial saves. Support literal commands and flag custom macros/dependencies.
DOI lookup remains deferred until its provider/provenance slice is enabled.

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
