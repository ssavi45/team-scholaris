# PAPER-04: paper file management, figure uploads, and ZIP import

## Delivered behavior

The paper workspace file explorer now includes a **Manage files / Import** action in the toolbar:

- **Folder & File Management**: Stage new folders or source files (`.tex`, `.bib`, `.sty`, `.cls`, `.txt`, `.bst`, `.clo`, `.cfg`, `.def`), rename or move existing paths (including moving nested descendants), and delete files or entire directory trees.
- **Main File Selection**: Change the compilation entry point to any `.tex` file in the project (defaults to `main.tex`).
  Nested main files compile through a temporary root entry inside the compiler worker so PDF retrieval and BibTeX use matching output names. Source/image/bibliography paths remain relative to the paper root. This entry is never saved or exported.
- **Figure Uploads**: Upload binary image assets (`.png`, `.jpg`, `.jpeg` up to 5 MiB each, 25 MiB total per paper). Figures are stored in a private Supabase Storage bucket (`paper-figures`) and previewed directly in the workspace with convenient `\includegraphics{path}` LaTeX snippets.
- **WASM Figure Compilation**: When compiling, `hydrateFigures` retrieves any referenced image binaries from private storage and mounts them into the SwiftLaTeX WebAssembly virtual memory filesystem, enabling full compilation of figures with `\includegraphics`.
- **ZIP Import**: Upload and unpack LaTeX source archives (e.g. from Overleaf or local projects) up to 20 MiB directly in the browser using a dedicated Web Worker. Safely filters macOS metadata (`__MACOSX/`), enforces decompression limits (zip bomb defense), validates path names (path traversal defense), and allows optional path replacement.
- **Atomic Manifest Application**: Changes are staged client-side in the dialog and committed atomically via the `apply_paper_manifest` RPC with optimistic concurrency protection (checking `revision`). Failed uploads or database conflicts cleanly roll back staged changes.

## Database & Security

- `20260915000100_paper_file_management.sql` extends `paper_files` with `kind` (`text`, `folder`, `image`), `storage_path`, and `size_bytes`. Adds `revision` and `main_file` to `paper_workspaces`.
- Enforces case-insensitive unique paths per project (`paper_paths_case_insensitive`).
- Private storage bucket `paper-figures` with Row Level Security enforced through `public.paper_storage_allowed(name, write)`. Only active owners and members can upload figures; viewers and members can download only committed figures. Referenced figures cannot be deleted directly from storage.
- `20260915000200_paper_source_guards.sql` adds update triggers ensuring non-text entries cannot be edited through the source-save RPC.

## Verification

```powershell
npm run lint
npm run build
node scripts/test-paper-export.mjs
node scripts/test-auth-navigation.mjs
node scripts/test-paper-compiler.mjs
node scripts/test-local-file-management.mjs
```
