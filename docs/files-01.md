# FILES-01: General Project Files Repository

## Delivered behavior

The project workspace now includes a central research file repository separate from the LaTeX editor:

- **Dedicated Files Workspace**: Accessible at `/project/:projectId/files` and via the **Files** navigation tab in the project header and paper workbench.
- **Quota & Storage Meter**: Real-time visual storage indicator tracking project storage usage against the database-enforced **500 MB** limit (`MAX_PROJECT_STORAGE_BYTES = 524288000`), with color-coded warning states.
- **Drag & Drop Upload**: Interactive drop zone supporting multiple file selection or drag-and-drop. Enforces a **50 MB** maximum limit per file (`MAX_FILE_SIZE_BYTES = 52428800`).
- **Diverse File Categorization**: Automatic classification and visual tagging for research artifacts:
  - **Data & Spreadsheets** (`.csv`, `.tsv`, `.xlsx`, `.parquet`)
  - **Papers & PDFs** (`.pdf`)
  - **Code & Notebooks** (`.py`, `.ipynb`, `.r`, `.js`, `.ts`, `.sh`)
  - **Archives & ZIPs** (`.zip`, `.tar.gz`, `.7z`)
  - **Images & Figures** (`.png`, `.jpg`, `.svg`)
  - **Scientific Data** (`.h5`, `.mat`, `.npy`)
- **Fast Search & Multi-criteria Filtering**: Instant client-side search by filename, category filtering, and sorting (by upload date, name, or size).
- **Authorized Download**: One-click download generating temporary 60-second secure signed URLs from private Supabase Storage.
- **Rename & Delete Management**:
  - Modal rename with duplicate name conflict detection and 255-character limits.
  - Deletion removes the database record and cleans up the storage binary.
  - No-op or denied writes are reported as failures. If binary cleanup cannot be confirmed after record deletion, the UI reports that separately.
- **Role-Based Access Control**:
  - Owners can manage all files; members can upload and manage their own uploads.
  - Viewers and members of archived projects have read and download access; upload and mutation controls are disabled.

## Database & Security

- **Migration**: `supabase/migrations/20260916000100_project_files.sql`
- **Table**: `public.project_files`
  - `id`: UUID primary key
  - `project_id`: references `public.projects(id)` ON DELETE CASCADE
  - `name`: file display name (case-insensitive unique per project)
  - `storage_path`: path in `project-files` bucket (`{projectId}/{fileId}-{sanitizedName}`)
  - `size_bytes`: validated between 1 byte and 50 MB
  - `mime_type`: content type string
  - `uploaded_by`: references `public.profiles(id)`
- **Quota Trigger**: `check_project_file_quota()` ensures cumulative storage per project never exceeds 500 MB.
- **Storage Bucket**: Private bucket `project-files` with 50 MB file limit and RLS policies via `public.project_file_storage_allowed`.
- **Security Definer Helpers**: `can_upload_project_file` and `can_manage_project_file` enforce strict team membership and ownership without leaking unprivileged `auth.users` table access.
- **RPC**: `public.get_project_files(p_project_id uuid)` efficiently returns files joined with uploader profile names.

The review migrations `20260919000100_files_chat_review_fixes.sql` and
`20260919000200_storage_reference_guard.sql` additionally verify uploaded object
ownership, project path, and actual size; restrict updates to rename fields;
serialize quota checks; block demoted viewers; and protect referenced objects
from direct Storage deletion. File removal and binary cleanup are separate
operations, so interrupted cleanup can leave an unreferenced object.

## Verification

```powershell
npm run lint
npm run build
node scripts/test-local-files.mjs
```
