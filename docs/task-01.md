# TASK-01: research tasks

Implementation is ready for manual acceptance. This increment was brought forward
at the user's request; Meetings and Settings have not been implemented.

## Scope checklist

| Planned capability | Implementation |
| --- | --- |
| Dedicated Tasks tab in the shared shell | `/project/:projectId/tasks` |
| Create, view, edit, and delete tasks | Native details dialog; deletion confirmation and soft deletion |
| Title and description | Required trimmed title, up to 160 characters; optional description, up to 5,000 |
| Assign teammates | Current owners/members only; optional unassigned state |
| Status | To do, In progress, Blocked, Done |
| Priority | Low, Normal, High |
| Due date and overdue indication | Date-only storage; overdue calculated against the viewer's local date |
| All, Assigned to me, Unassigned, Completed filters | Plus Open, Overdue, title search, and pages of 30 tasks |
| Owner/creator/assignee/viewer permissions | Checked in both UI and database functions |
| Complete and reopen | Completion timestamp recorded; reopening clears it |
| Departure or demotion cleanup | Database membership trigger unassigns unfinished tasks atomically |
| Historical attribution | Completed assignments and creator profiles retained after departure |
| Concurrent changes | Expected revision check; conflicting edits retain the form and show an error |
| Safe creation retries | Stable task ID per form; identical initial retry returns the same task |
| Deletion history | Server-written event survives task soft deletion |
| Overview integration | Open, overdue, and assigned-to-you counts with filtered links |
| Archived and unavailable states | Archived projects are read-only; removed users cannot fetch tasks |
| Responsive UI and form states | Loading, empty, search-empty, error/retry, disabled writes, draft warnings |

Assigned to me and Unassigned show unfinished tasks. All tasks includes completed
tasks. Owners manage every task; current member creators can edit/delete their
own; assignees can change status only. Viewers can read but cannot create tasks,
edit previously created tasks, or be newly assigned work.

Completed tasks keep their original assignee if that person leaves or is demoted.
When the owner/creator reopens one, the form clears an ineligible assignee so it
can be saved unassigned or assigned to another current editor. Leaving, removal,
and demotion also increment affected unfinished-task revisions to reject stale saves.

## Data and deployment

`20260920000100_project_tasks.sql` creates `project_tasks`, task functions, and a
minimal `activity_events` foundation. The event table has no browser write grants;
task mutations generate events transactionally through a trusted trigger.
Events store task title/status and actor attribution, not full task descriptions.
The Activity tab is a separate future build.

The local migration has been applied, including corrections to completed-assignee
validation and cascade cleanup. Hosted Supabase has not been changed. No new
dependencies were added. No task fixtures or task integration tests were run.
The user requested manual acceptance instead of further automated testing.

## Manual acceptance checklist

1. Open a project, choose Tasks, and create a task with description, member
   assignee, high priority, and yesterday's due date. Confirm it is overdue and
   persists after refresh.
2. Open Overview: verify open/overdue counts and the links back to filtered Tasks.
3. Try All, Open, Assigned to me, Unassigned, Overdue, Completed, and title search.
   With more than 30 tasks, check next/previous pages.
4. As the assignee in another browser profile, change the task to In progress,
   Blocked, then Done. Other fields and deletion must remain unavailable unless
   that person is also the creator. Confirm completion removes the overdue flag.
5. Reopen the completed task. Confirm it becomes unfinished and loses its completion
   timestamp. A past due date should make it overdue again.
6. As a different member, create and edit your own task, then try changing another
   person's task. As a viewer, confirm task details remain readable with no writes.
7. Give a teammate one unfinished and one completed task. Demote, remove, or have
   them leave through Team. The unfinished task should become unassigned; the
   completed task should retain their name. Reopen the completed task as owner.
8. Open the same task in two browser profiles. Save in one, then save stale edits
   in the other. The second form must show a conflict and retain entered text.
9. Delete a task with confirmation. It must disappear from lists and counts.
   Its `task.deleted` event remains available in the local `activity_events` table;
   no Activity screen is delivered yet.
10. Check narrow screens, keyboard navigation, closing a dirty form, refresh during
    loading, and unavailable/error states. Archived behavior requires an already
    archived project because Settings is not yet built. Do not alter real project
    state solely for a test without retaining a way to restore it.

Kanban, subtasks, dependencies, recurring tasks, comments, reminder emails, and
automatic realtime synchronization are outside TASK-01. Refresh and window-focus
reloads retrieve changes from other teammates.
