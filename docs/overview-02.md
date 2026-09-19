# OVERVIEW-02: project overview

The Overview uses the shared `ProjectTabShell` and brings the existing project
workspaces together without adding another management form.

## Delivered

- Four linked cards: Paper workspace, Files, Team, and Chat. Counts represent
  all current paper files (sources and figures, excluding folders), shared
  research files, and collaborators, rather than just the recent previews.
- Project description, your access and research role, creation date, status,
  and private team visibility. Shortcut copy respects viewer and archived access.
- Eight recent items combined from paper-file updates, shared-file additions,
  messages across all channels, and project creation, ordered newest first.
- Initial loading, new-project, unavailable, error/retry, archived, and partial
  summary failure states. Failed reads display unavailable counts, never zero.
- Refresh reloads the overview; returning to its browser window also refreshes.
  Aborted or older requests cannot overwrite the current snapshot.
- Responsive cards and activity rows follow the existing scholarly palette.

Activity describes existing records. It shows the latest update per paper file,
not every edit; deleted records disappear. There are no invented author names,
progress metrics, compile statuses, presence indicators, or unread counts.
Activity links open the relevant workspace, not a specific message or file.

## Data and permissions

`src/features/projects/overview-api.ts` uses the existing browser-safe Supabase
client and RLS policies. Queries select metadata only, with up to eight candidates
per source and exact file counts. Paper contents, message bodies, storage paths,
and private invitation details are not fetched for these summaries.

Project access is checked before and after the parallel reads. Removed users
receive the unavailable state on refresh. Owners, members, and viewers can read
the overview, including archived projects. This increment adds no writes,
dependencies, database migration, or hosted configuration changes.

## Verification

```powershell
node scripts/test-local-overview.mjs
npm run lint
npm run build
git diff --check
```

The local integration test exercises the actual frontend loader against local
Supabase with temporary accounts and a fixture project. It verifies empty state,
counts beyond the preview limit, folder exclusion, viewer reads, bounded metadata
queries, activity ordering when one source supplies all eight newest events,
partial query failure, archived reads, removed-member denial, and cancellation.
Fixtures are deleted afterward. The test refuses hosted Supabase URLs.

The integration test, lint, build, and whitespace checks passed. Interactive
browser verification remains pending because no browser session was connected.
For manual acceptance, open Overview as owner and viewer, refresh after making a
paper/chat/file change, check a new project, and inspect narrow-screen layout and
keyboard navigation.
