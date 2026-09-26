# Architecture and product decisions

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
