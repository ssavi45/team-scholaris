# PAPER-02: compilation, PDF preview, full-width workspace

[PAPER-03](paper-03.md) now adds PDF and source ZIP downloads; it supersedes the export exclusion below.

Open a project, choose **Paper workspace**, and press **Recompile**. With unsaved changes the action becomes **Save & compile**: the versioned save must succeed before compilation starts. The app then reads the current authorized source snapshot and builds `main.tex`. Editing can continue during compilation. Source changes mark the previous PDF as out of date; a failed compile preserves the last successful PDF and opens the log.

## Workspace

The outer `.workspace` spans the entire width, with no `max-width` or centered margins. The paper route also removes outer padding and fills the viewport below the app header. The file sidebar, source editor, and PDF preview scroll independently. Drag the divider or focus it and use Left/Right arrows to resize. Files can be collapsed; Source, Split view, and PDF controls change the working layout. On narrow screens, Source/PDF replaces the split and the file browser is an overlay. Authentication cards and dialogs retain their own readable sizing.

The design uses warm whites, muted green accents, compact toolbars, a paper-like preview background, and visible save/compile status. PDF.js renders one page at a time with previous/next controls, fit-width zoom, and an accessible page-text view. No document JavaScript or link actions are executed by the canvas-only preview.

## Compiler

- SwiftLaTeX's pdfTeX WebAssembly engine runs in a fresh Web Worker for each job. Source is compiled in worker memory; Supabase credentials are never passed to the worker. This adds no compilation server or paid service.
- Engine artifacts are served from `public/vendor/swiftlatex/`, pinned to release `v20022022`. `NOTICE.txt` contains SHA-256 checksums, the license, and an exact upstream source/build-script reference. Engine artifacts are unmodified; `scholaris-worker.js` is the separate Scholaris adapter.
- The original SwiftLaTeX package service was unavailable during implementation. The adapter uses the TeXlyre TeX Live 2020 mirror at `https://texlive.texlyre.org`. Its CORS and exposed `fileid` header were checked. Requests disclose package filenames and the client's IP to that service. Generated auxiliary files and bibliography source are never requested remotely. First compilation needs internet access; package availability depends on the mirror.
- Three pdfTeX passes, with the engine's BibTeX step, resolve normal cross-references and bibliographies. Compiler output is bounded to 150,000 log characters. Jobs time out after 120 seconds, package requests after 15 seconds, and **Cancel compilation** terminates the worker. Workers are also terminated on failure, success, and workspace unmount.
- Existing text-source limits are checked before starting the worker: 100 files, 512 KiB/file, 5 MiB total. The preview accepts PDFs up to 20 MiB and caps canvas raster dimensions at 4096 pixels. No files are uploaded to a compilation service and no PDF is persisted to Supabase.
- Viewers and archived projects may render an already-readable source snapshot locally. They cannot save or add source. Recompile rechecks project access before loading source.

This increment supports pdfLaTeX and traditional BibTeX. XeLaTeX/LuaLaTeX, Biber, shell escape, binary image/font uploads, ZIP/PDF export workflows, SyncTeX, and realtime collaboration remain outside scope. Engine and package versions are older than current desktop TeX Live; incompatible packages or Unicode/font needs surface in the compile log.

## Verification

```powershell
npm run lint
npm run build
git diff --check
node scripts/test-paper-compiler.mjs
node scripts/test-local-paper.mjs
node scripts/test-auth-navigation.mjs
```

`test-paper-compiler.mjs` runs the actual vendored JS/WASM and the worker adapter in an isolated Node test worker. It compiles a two-page document with nested source, amsmath, references, and BibTeX; PDF.js verifies page count and extracted text. It checks syntax failures, timeouts, cancellation, path validation, and worker cleanup. Test package downloads are cached under the system temporary directory; the generated verification PDF is also temporary. This is a compiler integration test, not a browser layout test.

Local paper tests verify database persistence, quotas, permission enforcement, and conflicting saves. No database migration is needed for this increment. Production build retains the existing main-bundle size warning; the PDF viewer and its worker load separately from the editor.

The user's desktop screenshot and compile log confirm a full-width split workspace and a rendered three-page PDF. The supplied paper has a missing `greenwade93` bibliography entry, which produces warnings while still generating the PDF. Automated interactive browser testing was unavailable in this session. Remaining manual acceptance:

1. At wide desktop size, confirm the workspace touches both edges and the source/preview use the available height. Resize the divider with mouse and keyboard.
2. Compile the initial paper, navigate PDF pages, adjust zoom, and open the page-text view.
3. Edit, choose Save & compile, then continue typing while the compiler runs. Confirm the new PDF is marked stale relative to later edits.
4. Introduce an undefined LaTeX command. Verify the error/log and the retained previous PDF. Fix it and recompile.
5. Cancel a compile, then retry. Test a missing package and an offline connection; verify failures do not erase source.
6. Try a conflicting save in a second tab: compilation must stop before using an unsaved conflicting draft.
7. At phone/tablet widths, toggle the file browser and Source/PDF views; confirm no horizontal page overflow.

References: [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX), [TeXlyre mirror configuration](https://github.com/TeXlyre/texlyre/blob/main/userdata.json), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
