# Project build sequence

TEAM-01 adds the dedicated Team tab, invitations, membership access changes,
research roles, removal, and self-leave. All project tabs share `ProjectTabShell`
except the independent full-width Paper workspace.

## Delivered: OVERVIEW-02

Overview now includes project summary, current access, team and file counts,
shortcuts to Paper/Files/Team/Chat, and recent activity from existing records.
Loading, empty, unavailable, partial failure, and archived states are covered.
See [OVERVIEW-02](overview-02.md) for behavior and verification.

## Next: MEETINGS-01

TASK-01 was brought forward and is now implemented, pending manual acceptance.
See [the scope checklist](task-01.md). Its task mutations also establish the
server-written event foundation for a later Activity build.

Add a Meetings tab in the shared project shell: upcoming and past meetings,
scheduled time displayed in the user's time zone, agenda, an optional external
join link, and shared notes. Store timestamps with time-zone information and
validate links. Do not build video calling or automatic calendar/email delivery.

Proposed permissions: owners and members can schedule meetings; creators can edit
or cancel their own, with owner oversight. Viewers can read. Archived projects
remain read-only, and removed members lose meeting access. Enforce these rules in
the database and test them before adding the UI controls.

## Following increments

1. **SETTINGS-01:** owner name/description edits and archive/unarchive, followed
   by ownership transfer and soft-delete/restore with dedicated confirmations.
   Enforce one owner and the recipient's owned-project limit transactionally.
2. **Activity:** keep it inside Overview initially; add a dedicated tab when the
   amount of history and filtering justify it.

The requested project destinations are Overview, Paper workspace, Files, Team,
Chat, Meetings, Settings, Tasks, and eventually Activity. Add functional tabs as
their builds land; do not introduce inactive navigation placeholders.

Paper collaboration remains a separate future increment: design persistent
shared-document state, reconnect recovery, cursor presence, and file-tree change
coordination before implementing multi-user editing. Chat Realtime alone is not
a shared-editor persistence strategy.
