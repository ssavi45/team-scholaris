# PAPER-01: single-user LaTeX source workspace

This describes the first source-editing increment. [PAPER-02](paper-02.md) now adds browser compilation, PDF preview, and the full-width workspace. Its behavior supersedes the compilation/preview exclusions below.

Open a project, choose **Paper workspace**, then **Create paper**. Each project has one workspace, initialized atomically with `main.tex` and `references.bib`. Repeating initialization does not overwrite source.

The lazy-loaded CodeMirror editor provides LaTeX highlighting, line numbers, undo/redo, and search. Save explicitly with **Save** or Ctrl/Cmd+S. Add source files using relative paths such as `sections/methods.tex`; folders are derived from paths and can be expanded or collapsed. Empty folders, rename/delete, uploads, compilation/PDF preview, ZIP import/export, templates, and live collaboration are outside this increment.

Owners and members can initialize, add, and save source. Viewers can read/copy it. Archived projects are read-only; deleted projects and revoked memberships cannot access source. These rules are enforced by database RLS and narrow RPCs, not just buttons. Direct table mutations and anonymous access are denied. Each save checks its expected version; competing saves cannot silently overwrite each other. A conflict or network failure keeps the current draft. Copy edits before using **Reload** to fetch the latest version.

Unsaved file switches, in-app navigation, tab close/reload, and explicit sign-out are guarded. Drafts are held in memory; they are not a browser crash-recovery mechanism. Saving temporarily locks the editor. Changes in other sessions are loaded explicitly with **Reload**; no presence or realtime editing is implied.

Source limits: 100 files, 512 KiB per file, 5 MiB total UTF-8 text. Supported extensions are `.tex`, `.bib`, `.sty`, `.cls`, `.txt`. Paths are case-sensitive ASCII names with letters, numbers, underscores, hyphens and dots, separated by `/`; hidden/path-traversal segments and file/folder collisions are rejected. These are text-editor limits, separate from future binary upload quotas.

## Apply and verify

With Docker running:

```powershell
npx --no-install supabase start
npx --no-install supabase migration up --local
node scripts/test-local-paper.mjs
node scripts/test-auth-navigation.mjs
npm run lint
npm run build
git diff --check
```

The local integration script uses public browser credentials for app requests. Administrative SQL is confined to temporary fixture setup and cleanup. It verifies initialization, member saves, viewer/outsider denial, path and size validation, concurrent version conflicts, persisted reloads, archive/deletion and membership revocation. It refuses hosted URLs. Existing user projects are preserved.

Manual acceptance:

1. Create a paper, edit/save `main.tex`, reload the page, and confirm persistence.
2. Add `sections/introduction.tex`, expand its folder, edit and save it. Check undo and search.
3. Edit without saving, then switch files, navigate back, sign out, or reload. Verify cancelling preserves the draft.
4. Open the same file in two tabs. Save in one, then attempt a stale save in the other. Confirm the conflict retains edits and Reload requires explicit discard.
5. Open as a viewer and in an archived project: copy/read source but do not edit. Test revoked access with a stale tab.
6. Check keyboard navigation and the stacked file/editor layout on a narrow screen.

Verified on September 14, 2026: migration applied locally and to the linked hosted development project (`pnkzzpjdezmrrcepcstv`). Paper integration tests, project regressions, auth navigation tests, lint, production build, and whitespace checks passed. The frontend still uses local Supabase. Database types were regenerated from the applied schema. The existing main-bundle size warning remains; CodeMirror is loaded in a separate paper-route chunk.

Interactive browser acceptance was not run because no browser connection was available. The manual checklist above remains to be exercised. No Git commit or push was performed.

Editor implementation references: [CodeMirror basic setup](https://codemirror.net/examples/basic/), [CodeMirror reference](https://codemirror.net/docs/ref/).
