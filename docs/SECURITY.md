# Security requirements

## Compiler cache boundaries

Persistent compiler storage contains allowlisted public package responses only.
Generated document files are excluded from network cache lookup/storage. Private
figures are cached only in memory within the current workspace, after fresh project
and manifest authorization reads, using immutable object paths. Access loss and
workspace teardown clear figures and stop the engine. /work is fully removed and
verified before each reused-engine job. Cache read/write failure must not bypass
validation or authorization. No credentials enter the compiler worker.


## PDF reading boundary

Render locally generated PDF bytes with the installed PDF.js worker. Never interpret
PDF JavaScript, actions, embedded attachments or arbitrary annotation HTML. Link
controls are created through DOM APIs: permit HTTP(S)/mailto URLs only, use
noopener/noreferrer for external tabs, and resolve internal PDF destinations through
PDF.js. Text and bookmark titles render as text. Search has a 1,000-result bound;
rendering uses a capped canvas window and bitmap dimensions. No new public preview
URL, storage bucket, auth bypass or cross-window message channel is introduced.


## Project search and replacement

Search uses already-authorized paper source; no external indexing service receives
manuscripts. Literal regex escaping avoids user-supplied regex execution. Results
are capped at 500 and replacement at 10,000 occurrences. Preview is not authority:
the manifest RPC rechecks identity, permissions, active project, revision and limits
under its existing transaction/lock. Dirty drafts, recovery problems and offline
state block frontend apply. Failed/stale operations never retry automatically.


## Manuscript history boundary

History bodies are server-written and returned only to verified current project
members through authorized RPCs. Viewers may inspect/download history; only active
owners/members may checkpoint, delete snapshots or restore. Removed users lose
access. Snapshot content must never be copied into Activity event metadata.

Restore checks the current workspace revision, serializes against other writes,
and preserves a safety checkpoint transactionally. File version clocks remain
monotonic across removal/restoration. Private immutable figures remain protected
while any live file or retained snapshot references them. Cleanup is explicit,
authorized and restricted to unreferenced objects older than one hour.


This document records current protections and requirements for future changes.
It is not a certification or a claim of completed production security review.
See [MEMORY](MEMORY.md) for known gaps and [TEST_PLAN](TEST_PLAN.md) for verification.

## Trust boundaries and secrets

The browser, form data, URL parameters, uploaded files, and local UI permissions
are untrusted. Supabase Auth establishes identity; PostgreSQL grants/RLS and
authorized backend operations enforce access. Never substitute route protection
or hidden buttons for server-side authorization.

`VITE_` values are public build output. Only the Supabase URL, browser-safe public
key, and public feature flags belong there. Accept hosted `sb_publishable_` keys
and legacy/local JWT keys declaring exactly `anon`; reject secret/service-role
keys and user access tokens as configuration. JWT decoding in environment
validation is not cryptographic verification. Public API keys do not replace RLS.

Keep database passwords, service-role/secret keys, Google client secrets, refresh
tokens, token-encryption keys and email-provider credentials in backend secrets
or ignored local environment files. Never paste credentials, authorization codes,
session tokens or full Supabase status output into logs, docs, chat, or commits.
Examples contain placeholders only. If a secret is exposed, revoke/rotate it at
the provider, replace affected configuration, assess impacted sessions/data, and
remove exposure from the repository/history as appropriate; deletion alone is
not credential revocation.

## Authentication and authorization

Private routes require a valid session and the required verified-email state.
Sensitive RPCs and Edge Functions must independently verify current identity.
Preserve safe same-origin return paths, pending invitation context, PKCE callback
handling, session cleanup, and recovery-flow checks. Auth users belong to their
selected local or hosted backend; credentials from one environment do not imply
an account exists in the other.

| Active-project action | Owner | Member | Viewer |
| --- | --- | --- | --- |
| Read project/research content | Yes | Yes | Yes |
| Edit paper/tree | Yes | Yes | No |
| Upload general files | Yes | Yes | No |
| Rename/delete general files | Any | Own uploads | No |
| Send chat | Yes | Yes | No |
| Delete chat | Any | Own messages | No |
| Invite/revoke/manage teammates | Yes | No | No |
| Leave project | Transfer ownership in Settings first | Yes | Yes |
| Create tasks | Yes | Yes | No |
| Edit/delete tasks | Any | Own created tasks | No |
| Change task status | Any | Creator or current assignee | No |
| Schedule meetings | Yes | Yes | No |
| Edit/cancel meetings and notes | Any | Own organized meetings | No |
| Read invitation activity | Yes | No | No |

Archived projects deny research mutations and invitations but retain reads and
member/viewer self-leave. Soft-deleted projects deny normal access. Outsiders
and removed teammates cannot access project data. Recheck membership on every
backend request, including after demotion and in stale sessions. Display/research
roles are descriptive and must never authorize actions. Exactly one owner must
remain; frontend direct membership writes are not a management API.

SETTINGS-01 adds owner-only lifecycle/ownership/recovery RPCs. Their implementation
and pending manual acceptance are recorded in [task.md](../task.md). Project table
writes remain unavailable to browser roles. Settings revisions detect stale
requests; caller-bound hashed-payload receipts reconcile retries without giving
former owners access to current project contents. Private receipt tables and the
generic internal operation function have no browser grants.

Transfers target another verified current member and atomically preserve exactly
one owner while enforcing the recipient quota. Transfer and Trash revoke pending
invitations. Owner-only Trash reads expose minimal metadata; restore uses server
time and quota checks, returns archived content, and reinstates retained team read
access. There is no hard-delete or automatic purge operation in this build.

## Database and API integrity

- Enable and retain appropriate RLS on exposed tables and private Storage.
  Give each role only needed table columns and function execution rights.
- Security-definer functions use fixed search paths, explicit caller checks,
  validated inputs, narrow grants, and atomic mutations. Do not expose a generic
  privileged mutation endpoint or trust caller-supplied actor IDs.
- Validate IDs, strings, lengths, enums, membership, project state, sizes and
  revision numbers at the trusted boundary as well as in the UI.
- Preserve project/owner constraints, row locks and quota serialization.
  Concurrent requests must not bypass quotas or overwrite stale versions.
- Clients cannot write Activity history. Server events contain minimal metadata,
  never message/paper bodies, notes, invite tokens/emails or storage paths.
- Edge Functions check authentication, allowed origins, request shape and current
  permissions. `verify_jwt = false`, where used for function routing, does not
  remove the need for the handler to authenticate protected actions itself.
- Render chat, task descriptions, agendas and notes as plain text. Validate join
  links as HTTPS and open external pages without opener access.

## Invitations

Invitations use random, expiring tokens stored as hashes, verified intended-email
matching, explicit acceptance, and single-use/revocation checks. Current expiry
is seven days. Rate limits and active-owner checks are enforced server-side.
Replacement/revocation must invalidate old tokens. An accepted invite cannot
restore a removed member; rejoining needs a fresh invitation. The email function
uses the requesting user's authorized RPCs rather than browser-held privileges.
Invitation mail is the only required email notification workflow at present.

## Files, imports and compilation

Private buckets are not public CDN directories. General file registration checks
the actual uploaded object ownership/path/size and immutable identity fields.
Only allowed metadata changes are granted. Enforce the 50 MiB/500 MiB general
file limits in trusted logic, including concurrent uploads. Signed download URLs
are short-lived (currently 60 seconds for general Files).

Paper paths must reject traversal, absolute paths, invalid names, case-insensitive
duplicates, and file/folder conflicts. Enforce source/figure/count totals, ZIP
decompression bounds, and PNG/JPEG signature matching. Do not trust extensions,
browser MIME declarations, or compressed size alone. Uploaded code/general files
are download artifacts, not executable application content. No malware-scanning
service is currently implemented; do not claim files have been scanned.

Referenced Storage objects cannot be removed directly. Metadata removal followed
by binary cleanup can fail partially; report the residual cleanup state and do
not silently claim all data is erased. Previously downloaded data cannot be
recalled, and previously issued signed links can remain valid until expiry.

Compile untrusted LaTeX only through the bounded browser worker, with no backend
credentials and no server shell execution. Preserve timeouts, cancellation,
output/log limits, workspace-only source resolution, and PDF preview constraints.
Keep compiler license notices. Review worker/package-fetch boundaries when
updating the engine; browser isolation is not an unlimited resource guarantee.

## Google Calendar integration — paused

The existing design binds OAuth state to the authenticated user, intended project,
fixed callback and initiating browser. It uses PKCE, a short-lived single-use
state, and an HttpOnly SameSite cookie. Refresh tokens are encrypted with AES-GCM
and user-bound associated data. Integration tables are inaccessible to ordinary
browser roles; only the backend holds privileged access.

Keep event authorization limited to the organizer's connected Google identity
and the needed calendar/identity scopes. A project owner cannot use someone
else's credentials. Disconnect removes local credentials and attempts revocation;
existing calendar events/Meet URLs remain. Cancellation does not guarantee ending
a call or invalidating a Meet URL. Notes and Google attendee invitations are not
exported. Handle partial remote success through operation reconciliation rather
than creating duplicate events.

The local gateway credentialed CORS issue remains unresolved. Fixing CORS must
preserve browser binding, exact origin handling and credential security; a Node
fetch success is not browser OAuth acceptance. Reassess provider consent and
production configuration when this paused work resumes.

## Privacy and release requirements

Research data lives in the configured Supabase project and the authorized browser.
Local Mailpit captures email; hosted delivery may send invitation details through
Resend. Google Fonts receives font requests; the TeX package mirror receives
runtime package requests. Google Calendar receives authorized meeting metadata
only when its integration is used. Record these dependencies in any future
privacy policy and review provider settings before public release.

Before release, verify hosted migration/RLS/Storage parity, role-isolation tests,
HTTPS and Auth callback allowlists, function secrets, dependency/vendor licensing,
backup/recovery arrangements and operator access. A frontend hosting provider,
formal data-retention/purge policy, and production recovery runbook are not yet
established. Expiry of the 30-day restore window is not evidence of physical deletion.

## Profile and avatar access

Profile fields remain owner-readable; updates go through a verified-user RPC
with validation, unique usernames and stale-write rejection. Photo uploads use
an owner namespace, immutable UUID paths, a private bucket, a 1 MiB stored-file
limit and a four-object quota. The frontend checks image signatures, accepts
JPEG/PNG/WebP up to 5 MiB and re-encodes a square WebP without source metadata.
Backend checks stored metadata/ownership; it does not independently decode bytes.
Current teammates may read only the saved avatar through a restricted RPC and
Storage policy. Unrelated users and removed members cannot obtain new URLs;
previously issued one-hour signed URLs remain usable until expiration.
Unsaved avatar uploads, email preferences, bio and affiliation are not shared.
