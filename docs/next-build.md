# Project build sequence

TEAM-01 adds the dedicated Team tab, invitations, membership access changes,
research roles, removal, and self-leave. All project tabs share `ProjectTabShell`
except the independent full-width Paper workspace.

## Next: OVERVIEW-02

Make Overview a useful starting point: project summary, current access, team and
file counts, shortcuts to Paper/Files/Team/Chat, and a small recent-activity section
based on existing records. Include loading, empty, unavailable, and archived
states. Avoid fabricated metrics, progress percentages, or duplicate management
forms. Respect current project permissions for every query and link.

## Following increments

1. **MEETINGS-01:** schedule project meetings with time zones, agenda, join link,
   and notes. Define who can create/edit/cancel before implementing database rules.
2. **SETTINGS-01:** owner name/description edits and archive/unarchive, followed
   by ownership transfer and soft-delete/restore with dedicated confirmations.
   Enforce one owner and the recipient's owned-project limit transactionally.
3. **TASKS-01:** lightweight assignments, status, and due dates after the core MVP.
4. **Activity:** keep it inside Overview initially; add a dedicated tab when the
   amount of history and filtering justify it.

The requested project destinations are Overview, Paper workspace, Files, Team,
Chat, Meetings, Settings, Tasks, and eventually Activity. Add functional tabs as
their builds land; do not introduce inactive navigation placeholders.

Paper collaboration remains a separate future increment: design persistent
shared-document state, reconnect recovery, cursor presence, and file-tree change
coordination before implementing multi-user editing. Chat Realtime alone is not
a shared-editor persistence strategy.
