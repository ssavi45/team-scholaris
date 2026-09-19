# CHAT-01: Real-time Project Chat & Design System Upgrade

## Delivered behavior

The project workspace now includes real-time collaborative discussion channels alongside a platform-wide design system and asset upgrade:

- **Dedicated Real-Time Chat**: Accessible at `/project/:projectId/chat` and via the **Chat** navigation tab across Project Overview, Files, and the Paper Workbench.
- **Contained Workspace Layout**: Overview and Files use a 1080px container; Chat uses a responsive 1360px workbench. The LaTeX editor remains full-width.
- **Supabase Realtime Postgres Stream**: Zero polling. Messages stream instantly via Supabase Realtime channel postgres change subscriptions on `public.project_messages`.
- **Connection Status**: Reports the actual Realtime subscription state. Reconciles the latest messages when connected, reconnected, refreshed, or the window regains focus. Team membership is not presented as online presence.
- **Recent History**: Shows the newest 100 messages per channel in chronological order, with deterministic ordering for equal timestamps. Older messages remain stored; history pagination is not implemented yet.
- **Day-Grouped Feed**: Messages are chronologically grouped by day separators ("Today", "Yesterday", or formatted dates).
- **Scholar Editorial Typography & Premium Assets**:
  - Bespoke vector iconography using `lucide-react` across chat, files, and navigation (replacing all generic emojis).
  - Editorial font pairing with Google Fonts:
    - **`Plus Jakarta Sans`** for crisp geometric UI controls and reading text.
    - **`Newsreader`** for academic serif branding and section headers.
    - **`JetBrains Mono`** for monospace code snippets and timestamps.
- **Interactive Composer**:
  - Auto-growing multiline input with `Enter` to send and `Shift+Enter` for multi-line formatting.
  - Character counter (up to 4,000 characters per message).
  - Plain text with preserved line breaks; code/math rendering is not implemented.
  - Separate in-memory drafts per channel, IME-safe Enter handling, and protection against duplicate sends.
  - Read-only composer banner when viewed by read-only viewers or archived projects.
- **Message Moderation & Author Actions**:
  - Senders can delete their own messages.
  - Project owners can moderate and delete any message in the project.
  - Viewers and outsiders cannot send or delete messages.
  - Sent messages are labelled "Sent"; read receipts are not implemented. Unimplemented call, poll, emoji, search, and settings controls are omitted.

## Database & Security

- **Migrations**: `20260916000200_project_chat.sql`, `20260916000300_chat_channels.sql`, and `20260919000100_files_chat_review_fixes.sql`.
- **Table**: `public.project_messages`
  - `id`: UUID primary key default `gen_random_uuid()`
  - `project_id`: references `public.projects(id)` ON DELETE CASCADE
  - `sender_id`: references `public.profiles(id)`
  - `content`: text validated between 1 and 4,000 characters
  - `created_at`: timestamptz default `now()`
  - `updated_at`: timestamptz default `now()`
- **Realtime Replication**: `alter table public.project_messages replica identity full; alter publication supabase_realtime add table public.project_messages;`
- **Row-Level Security (RLS)**:
  - `SELECT`: `public.can_access_project(project_id)` (accessible by active members and viewers).
  - `INSERT`: `public.can_upload_project_file(project_id) and sender_id = auth.uid()` (owners and members).
  - `UPDATE`: denied to frontend users; message editing and changes to sender/project/channel identity are unsupported.
  - `DELETE`: `public.can_manage_project_file(project_id, sender_id)` (sender or project owner).
- **RPC**: `public.get_project_messages(p_project_id, p_limit, p_channel)` joins sender profiles and roles, bounds the limit to 1–100, selects the newest window, then returns it in reading order.
- **Deletes**: The Realtime listener uses deleted primary keys to remove matching records from the authorized local snapshot. It does not depend on an old-row project filter with RLS. See [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## Verification

```powershell
npm run lint
npm run build
node scripts/test-local-chat.mjs
```
