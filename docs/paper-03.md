# PAPER-03: PDF and source ZIP downloads

Use **Export** beside Recompile in the paper toolbar. The dialog captures the workspace as it was when opened, so a background compilation cannot silently replace the selected PDF. Close and reopen Export to capture newer work.

- **Download PDF** exports the exact last successful compiler output, without re-rendering or recompiling it. If source has changed, compilation failed, or another compilation is running, the user must explicitly select the previous PDF checkbox. Its filename ends in `-last-compiled.pdf`. Compiler warnings are disclosed. With no compiled output, the button is disabled.
- **Download source ZIP** includes the currently loaded source files at their original relative paths, including `main.tex`, `references.bib`, nested folders, empty files, and UTF-8 content. No generated auxiliary files, compiler output, credentials, or project metadata are added.
- When the active editor has unsaved edits, **Include unsaved edits** is selected by default. Unchecking it uses that file's last loaded saved content. Either option leaves the database and editor untouched. The ZIP is a copy of the loaded workspace, not a claim that all other users' latest edits have been fetched.
- Exports are available to anyone who can read the loaded paper, including viewers and archived projects. This is a local operation on already-readable data and works without a fresh database request. It does not grant additional access or create a shared/public link.
- Source paths and size limits are validated before packaging. Download names remove filesystem-unsafe characters, limit length, and handle reserved Windows names. The ZIP uses the lazy-loaded `fflate` package. Closing the dialog cancels ZIP preparation. Download URLs are revoked after a short delay to let the browser consume them; failures clean up immediately.

No database migration, storage bucket, export server, or environment change is needed. Importing ZIPs, standalone source-file download actions, and realtime collaboration remain outside this increment.

## Validation

```powershell
node scripts/test-paper-export.mjs
npm run lint
npm run build
git diff --check
```

Tests cover ZIP paths and UTF-8 content, empty bibliography preservation, draft inclusion/exclusion, immutable input snapshots, metadata exclusion, invalid paths and oversized drafts, safe filenames, exact PDF bytes, cancellation, and download URL cleanup. A generated ZIP was also opened with the independent .NET ZIP reader. Production build retains the existing main-bundle size warning; the export dialog and compression library load on demand.

Manual browser acceptance:

1. Compile a paper, open Export, download the PDF, and confirm its pages match the preview.
2. Edit source without saving; export ZIP with draft inclusion on and off and compare `main.tex`. Verify the workspace still shows unsaved edits.
3. Open a source ZIP in a desktop archive reader and compile `main.tex` in an appropriate LaTeX environment.
4. Change source or trigger a compilation failure. Verify previous PDF download requires explicit acknowledgement.
5. Try export while another compile runs; the open dialog must retain its original snapshot.
6. Close while preparing a large ZIP, then reopen and retry. Check narrow-screen toolbar layout and keyboard/Escape behavior.

Actual browser download interactions remain manual when no browser connection is available. The UI reports that a download was requested, not that the browser completed saving it.

Library reference: [fflate ZIP API](https://github.com/101arrowz/fflate).
