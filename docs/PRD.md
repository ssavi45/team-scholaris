# Product Requirements Document

## Shared-writing pilot

Coauthors can open Live writing for a selected source, edit concurrently, undo their
own changes, see named cursors/selections and recover unsent edits on the same device.
Starting/ending is owner-controlled. The pilot keeps legacy edits fenced while a
file is enrolled. Browser UI is implemented; full lifecycle, optional follow mode,
cross-gateway presence and real-browser release acceptance remain outside this slice.

## Coediting architecture proof (PAPER-12)

Prove that concurrent authors can merge edits without silent loss before offering
live shared writing. Deliver an isolated prototype, failure/recovery evidence,
architecture decision and gated rollout plan. This build adds no user-visible
collaboration status, cursors or production simultaneous editing. Existing
versioned-save conflict protection remains the active writing protocol.

## Flexible equation composition

Insert equation supports free-form LaTeX, inline/display/numbered/aligned layouts,
optional labels, editable building blocks and a local live preview. Source stays
editable. Custom macros may require full compilation. No handwriting/image OCR
or full visual math editor in this increment.


## Assets and starters (PAPER-11)

Authors can preview file moves and repair supported LaTeX references, import files
with explicit conflict choices, insert an uploaded figure with caption/label, and
start from an original article, report or multi-file thesis skeleton. Existing
papers are never silently replaced. General Files copying and unsupported figure
conversion are deferred optional slices.


## References without guesswork (PAPER-10)

Search local BibTeX by author/title/year/key, insert citations or label references
at the cursor, and complete known keys. The manager reports missing/duplicate
literal keys with locations, imports with explicit duplicate choices, edits common
fields, and previews citation updates before key renames. Raw BibTeX remains
editable and untouched outside explicit changes. Advanced macros/styles require
source editing; compilation is authoritative. DOI lookup is a separately enabled
future slice; external library sync remains out of scope.

## Continuous manuscript reading (PAPER-09)

Readers scroll naturally through all pages, preserve their reading position across
recompiles, search occurrences, select/copy text and follow citations or safe links.
Page jump, zoom/fit/rotate/focus and bookmark/thumbnail navigation support long papers.
Source lookup uses clearly labelled text search because this compiler has no verified
SyncTeX output. Exact coordinate mapping and a separate preview window remain gated.


## Comfortable editing (PAPER-08)

Authors can navigate included chapters, find text across current drafts, reopen
closed documents, insert undoable LaTeX snippets and customize editor readability.
Project replacement requires a preview and saved, conflict-free source and rejects
stale revisions. Word counts are approximate current-file counts, not publication
metrics. Outline supports literal headings and includes, not complete TeX expansion.
Advanced spellcheck and simultaneous coediting are outside this increment.


## Trustworthy compilation (PAPER-07)

An author can understand an error, navigate to a reported source line, repair it,
and retry without losing edits or the last good PDF. Compilation identifies its
saved revision/main file and distinguishes failure, cancellation, stale output,
warnings and bibliography errors even when a PDF was generated. Unknown locations
remain log context rather than guessed navigation. Manual compilation is the
default; optional compile-on-save awaits acceptance of the reliable manual path.


## Recoverable manuscript history (PAPER-06)

Authors can label checkpoints, compare saved source/tree revisions, download old
source with its figures, and restore a file or whole paper as a new revision.
Every restore preserves today's paper in a protected safety checkpoint. Viewers
can inspect authorized history. This complements local draft recovery; it does
not provide simultaneous coediting or an unlimited archival backup service.


## Product and purpose

**Team Scholaris** is a private, project-based research collaboration workspace.
The intended domain is `teamscholaris.tech`; this is a product identity, not a
claim that production hosting is deployed.

Research teams move between paper editors, file storage, chat, task lists, and
meeting tools. Context becomes fragmented and handoffs become harder. Scholaris
brings these workflows together with the research paper at the center.

Primary users are university students, academic project groups, student paper
teams, and small research labs. Advisors can join with read-only access.

The product hypothesis is: a research team will use Scholaris as its central
workspace for managing and writing a research project. Keep the product focused,
simple to operate, and approximately free to run during early development within
service limits. This cost target is not a guarantee of free production hosting.

## Core journey

Sign up and verify email → create a private project → invite teammates → write
and compile a paper → share files and discuss findings → coordinate tasks and
meetings → export the research artifacts.

## Requirements and delivery scope

| Area | Required behavior | Current delivery |
| --- | --- | --- |
| Authentication | Email/password, verification, recovery, persistent sessions, protected routes; optional Google sign-in | Email flows implemented; Google provider requires environment setup |
| Dashboard/projects | Owned and joined projects, pending invitations, project creation, private access | Implemented; five retained owned projects per user |
| Team/invitations | Exactly one owner; owner/member/viewer access; descriptive research roles; expiring email invitations; removal and self-leave | Implemented; ownership transfer is available in Settings |
| Paper workspace | One workspace per project; source tree, explicit saves, compilation, preview, source/PDF export, import and figures | Single-user editing implemented through PAPER-04; simultaneous coediting remains future work |
| Files | Flat research-file repository with upload, download, search, rename, delete, quotas | Implemented; separate from paper assets |
| Chat | Persistent project discussion with actual realtime delivery | Implemented with existing channels; viewers read only |
| Overview | Real project/team/file summaries, task counts, next meeting, recent durable activity, shortcuts | Implemented; never fabricate progress, presence, or compile status |
| Tasks | Assignments, status, priority, due dates, filters, completion/reopening, permissions | TASK-01 implemented and user-reported working |
| Activity | Durable server-written history, filters, pagination, authorized item links | ACTIVITY-01 implemented and user-reported working |
| Meetings | Team schedules, time zones, agenda, attendees, external HTTPS link, shared notes, cancellation | MEETINGS-01 implemented; full acceptance checklist remains relevant |
| Google Meet | Connect organizer account; create instant/scheduled Meet links inside Scholaris | MEETINGS-02 implementation exists but is paused; browser connection unresolved |
| Settings/recovery | Edit details, archive/unarchive, transfer ownership, Trash and restore | SETTINGS-01 implemented locally; manual acceptance pending in root task.md |

Later user requests expanded the original MVP to include Tasks and Meetings.
Current implementations also retain chat channels from local user changes.
These supersede the original narrow feature sequence; they do not authorize
additional features automatically. See [decisions](DECISIONS.md).

## Access and lifecycle requirements

- Projects are private to current teammates. Research-role labels never grant
  access; only owner/member/viewer does.
- Owners manage the team. Members edit research content subject to feature-level
  ownership rules. Viewers read without mutating, including chat in the current
  implementation. The original viewer-chat discrepancy remains a beta decision.
- Owners must transfer ownership before leaving through Team. Departure preserves contributions and
  attribution while removing future access.
- Archived projects remain readable and count toward the five-owned-project
  limit. Members/viewers may still leave. Settings supplies owner lifecycle controls.
- Deletion is recoverable soft deletion. SETTINGS-01 enforces a server-authoritative
  30-day recovery window and restores into archived state with retained membership.
  Dashboard Trash exposes only owner recovery metadata. No automatic physical
  purge is implemented or promised.

## Feature details and limits

### Paper and files

Paper uses a full-width source/PDF workspace. Saving is explicit, conflicts retain
drafts, and failed compilation preserves the last successful PDF with stale-state
feedback. PDF and ZIP exports must reflect an identified snapshot, including the
user's choice about unsaved source. Nested main files and BibTeX are supported.

Current paper limits are 100 files **and folders**, 512 KiB per source, 5 MiB total
source, 5 MiB per PNG/JPEG figure, 25 MiB total figures, and 20 MiB compressed ZIP
import. Source extensions are `.tex`, `.bib`, `.sty`, `.cls`, `.txt`, `.bst`,
`.clo`, `.cfg`, and `.def`. The compiler uses pdfTeX; XeLaTeX, LuaLaTeX, Biber,
arbitrary shell commands, and every Overleaf project are not supported promises.

General Files remains a flat list, with a 50 MiB individual limit and 500 MiB
project quota (the UI/code labels these as MB). Members manage their own uploads;
owners manage all. Paper figure limits are separate from the general Files quota.

### Coordination

Chat accepts up to 4,000 characters, displays the newest 100 messages per channel,
preserves line breaks and channel drafts, and labels delivery as Sent. Older
history is stored but does not yet have UI pagination. No read receipts or online
presence claims are allowed.

Tasks support To do, In progress, Blocked, Done; Low, Normal, High priority;
optional editor assignee; and a date-only due date. Owners manage all, member
creators manage their tasks, and assignees may update status. Departure/demotion
unassigns unfinished tasks while retaining completed attribution.

Meetings store UTC instants and the original IANA time zone. Owners/organizers
manage schedules and notes. Attendees may include viewers, but selection sends
no calendar/email invitation. Cancellation retains history and hides Join.
Google-generated calls, when the integration is eventually accepted, open in
Google Meet; Scholaris does not host or embed the video call.

## Success criteria

A pilot team should be able to complete the core journey with real persisted
data, invite a second account, collaborate within its permissions, compile a
paper with a resolved bibliography, and download a usable PDF/source ZIP.

Additional acceptance requires that outsiders cannot read project data, viewers
cannot write, removed members lose future access, stale edits do not silently
overwrite work, and supported flows work with keyboard and narrow screens.

Evaluate whether teams return to continue real research and can recover from
network/compile errors without losing work. No analytics instrumentation,
retention baseline, or measured adoption result is claimed. Executable scenarios
are in [TEST_PLAN.md](TEST_PLAN.md).

## Outside the current build

Realtime paper coediting/presence, citation search via Crossref/OpenAlex, template
catalogues, DOCX conversion, notifications, public reviewer links, institutional
accounts, billing, AI features, mobile apps, arbitrary permission builders,
Kanban/subtasks/dependencies, recurring meetings, and hosted video infrastructure
remain future possibilities, not current commitments. Cloudflare R2, Yjs, and
self-hosted Overleaf are not part of the deployed implementation.

## Account profiles (PROFILE-01)

Users open their personal profile from the navbar badge, edit their display name
and generated email-derived username, and choose username or email on the badge.
They choose one of ten artwork avatars or upload a JPEG/PNG/WebP photo. Saved
avatars appear in chat to current teammates. Optional bio/affiliation remain
private. Include live preview, save/reload feedback and unsaved-change protection.
