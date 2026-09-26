# Project memory

Last updated: **2026-09-27**, after SETTINGS-01 implementation. This records the
local delivery and its verification boundary; manual workflow acceptance has not
been performed by the agent.

## Current position

Branding update: the supplied PNG favicon is linked in index.html, and the
shared BrandLogo component displays the supplied wordmark on application/Paper
headers and auth screens. Responsive sizing replaces the previous text/S badge;
the original image files are preserved. The favicon now uses a tightly framed
`team-scholaris-favicon-v2.png` so its mark fills the browser tab icon area;
the new URL avoids reusing the previously cached padded image.

Team Scholaris has a working local research-workspace foundation and multiple
delivered increments. **SETTINGS-01 is implemented locally and awaiting the user's
manual acceptance. Google Meet work remains paused by the user.**

The only build tracker is [root task.md](../task.md). It contains the retained
end-to-end Settings contract and implementation/acceptance checklist. Do not resume
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

Reports of historical verification apply to that revision and environment. They
are not evidence that the current tree or hosted deployment has just passed.

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

1. **Google connection:** the local Supabase gateway intercepted a credentialed
   browser preflight and returned wildcard origin without the required credential
   permission. `google-calendar-api.ts` uses `credentials: 'include'` for OAuth
   browser binding. Consequently the browser can reject the request before the
   function handles it. A same-origin development proxy was considered but has
   not been implemented. Do not weaken OAuth protections to bypass this failure.
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
authorization remains blocked. No production frontend hosting or complete hosted
rollout is certified. No commit, push or hosted deployment was performed for Settings.

## Handoff

Read [RULES.md](../RULES.md), this file and [task.md](../task.md), then inspect the
current tree before working. Existing local changes include application work
from previous increments; do not discard them. Next, collect the user's Settings
acceptance and address concrete findings before selecting a new build. Preserve
all retained research data. Keep the single task tracker current, record exact verification
performed, and update this memory at handoff. User workflow acceptance is manual
unless they request otherwise; do not silently claim unperformed checks passed.
