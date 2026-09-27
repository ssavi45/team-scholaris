# Paper workspace roadmap and build tracker

Last updated: 2026-09-27. **Planning only; no new paper functionality has been implemented.**
This is the only task tracker. Current product focus: make Paper the reason a
research team chooses Scholaris. Previous delivery records remain below.

## Product judgment: what must earn the user's trust

As a student coauthor, I want to open my paper, continue where I stopped, write
without worrying about saving, resolve a broken citation quickly, and hand my
supervisor a correct PDF. As the lead author, I need to recover yesterday's text
and work alongside a teammate without overwriting them. As an advisor, I need
to find the relevant passage and leave precise feedback without learning the UI.
These are proposed user perspectives, not findings from interviews already run.

The most important requirements, in order:

1. **Do not lose or silently overwrite research.** Recover drafts, show truthful
   save states, keep history, and make conflicts recoverable.
2. **Produce a trustworthy paper.** Compile the intended snapshot, explain
   failures, resolve references, and distinguish an old PDF from current output.
3. **Keep writing uninterrupted.** Switch files without discarding text, retain
   undo/cursor/preview position, and make navigation fast.
4. **Make collaboration safe.** Current revision checks are useful protection,
   but they are not simultaneous editing. Build real coediting deliberately.
5. **Make review and submission easy.** Anchored feedback, reliable citations,
   consistent assets and reproducible source/PDF export.
6. **Make the interface comfortable for hours.** Compact full-width layout,
   readable themes, keyboard access and responsive review on small screens.

A beautiful shell supports these jobs; it cannot compensate for a lost draft or
an incorrect bibliography. Do not spend the next increment on decorative UI.

## Review basis and current baseline

This review inspected the implementation and project documentation. It was not
a fresh browser usability session or a claim that every existing flow passed.
Past user-confirmed compilation/downloads remain historical evidence.

| Area | Present in code | User-facing gap / next action |
| --- | --- | --- |
| Layout | Full-width Source/Split/PDF modes, collapsible file sidebar, pointer/keyboard splitter, light/dark editor | Layout/view state is component-local; no saved working position or focused writing mode |
| Editing | CodeMirror basicSetup, LaTeX highlighting, line numbers, basic editor search/undo support, Ctrl/Cmd+S | One active draft; file switches prompt to discard. Editor keyed by file ID remounts, so per-file undo/selection is not retained |
| Saving | Explicit save, expected-version RPC, leave/sign-out guards | No autosave, durable local recovery, conflict comparison or persistent draft-per-file model |
| Compiler | Browser pdfTeX worker, three passes, BibTeX workflow, nested entry support, progress/cancel/120s timeout | Mostly raw log with warning count; no clickable issue list, documented compatibility corpus or measured cold/warm performance |
| Preview | Single-page canvas, previous/next page, fit-relative zoom, extracted page text | No PDF search/text-selection layer, continuous reading or source/PDF mapping; keyed preview remount resets position on compile |
| Source/assets | Nested tree, entry-point choice, staged rename/move/delete/import, PNG/JPEG figures | Management requires a dialog and saved source; renames explicitly do not rewrite references; no figure insertion assistance |
| Citations | Editable .bib files and compiler integration | No citation/key picker, duplicate-key audit or friendly missing-entry repair; no external reference search |
| Export | PDF and source ZIP, draft choice and stale-PDF warning | No named submission package binding source revision to PDF and validation results |
| Team writing | Project access levels and stale-save rejection | No shared editing session, real presence, anchored comments, manuscript revision history or suggestions workflow |

Evidence: [PaperPage](src/features/paper/PaperPage.tsx),
[SourceEditor](src/features/paper/SourceEditor.tsx),
[PdfPreview](src/features/paper/PdfPreview.tsx),
[paper API](src/features/paper/paper-api.ts),
[compiler](src/features/paper/compiler.ts),
[file manager](src/features/paper/FileManager.tsx),
[export](src/features/paper/ExportDialog.tsx).
Do not rebuild existing imports, exports, resizing or basic editor search.

## Workspace interaction contract

- A compact Paper toolbar exposes file/outline navigation, source/PDF modes,
  truthful save state, compile status, and export. Later History/Review tools
  open on demand. Keep the document area full-width and maximize vertical space.
- Left panel: Files / Outline / Search, with References added when implemented.
  Center: open-file tabs and editor. Right: PDF or a deliberately opened review
  panel; avoid squeezing every tool into simultaneous columns.
- Issues open in a collapsible panel with error/warning counts and a raw-log tab.
  Selecting an issue opens its file and line without losing another draft.
- Save and compile are separate states. "Saved" means acknowledged by the server;
  "Saved on this device" means recoverable locally. A generated PDF with unresolved
  citations is "Compiled with warnings", not a clean submission.
- Desktop split editing is the primary creation experience. Tablet/phone use
  single panes with reachable actions; support quick edits and review without
  promising desktop density on a phone. PDF paper stays white in dark mode.
- Keep existing project navigation, roles, archive restrictions and compiler
  isolation. No new global application redesign is required.

## Build order and release gates

All unchecked items are proposed work, not accepted delivery. Complete one build
at a time; split implementation into its listed slices rather than one large PR.
The estimates are relative scope (M/L/XL), not promised dates.

| Build | Priority / size | Outcome | Dependencies |
| --- | --- | --- | --- |
| PAPER-05 | P0 / L | Durable drafts and safe autosave | Existing PAPER-01?04 |
| PAPER-06 | P0 / L | Revision history and safe restore | 05 |
| PAPER-07 | P0 / L | Reliable compilation and actionable errors | 05; history revision contract from 06 |
| PAPER-08 | P1 / L | Fast, comfortable editing and navigation | 05, 07 issue navigation contract |
| PAPER-09 | P1 / L | Useful PDF reader and preserved position | 07, 08 |
| PAPER-10 | P1 / M | Citation and cross-reference assistance | 07, 08 |
| PAPER-11 | P1 / M | Assets, file operations and starter templates | 05, 06, 08 |
| PAPER-12 | P0 for team release / M | Prove a safe coediting architecture | 05?07; may investigate earlier without shipping |
| PAPER-13 | P0 for team release / XL | Real simultaneous coediting | Accepted 12 decision; migrate 05/06 contracts |
| PAPER-14 | P1 / L | Anchored review and resolution | 06, 08, 13 |
| PAPER-15 | P1 / M | Submission checks and reproducible handoff | 06, 07, 10, 11 |
| PAPER-16 | Release gate / M | Accessible, performant research-team pilot | 05?15 and manual acceptance |

**First milestone:** 05?07 make writing recoverable and compiling understandable.
**Individual-author beta:** 05?11 plus a scoped accessibility/performance pass.
**Team-author beta:** add 12?15 and pass 16; do not market live coediting earlier.
P0 means a release blocker for its milestone, not permission to bypass dependencies.

## PAPER-05 ? Durable drafts and safe autosave (recommended next build)

**User story:** "I can edit several files, lose my connection, or accidentally
refresh without losing work, and I know whether teammates can see my changes."

- [ ] Slice A ? Extract a per-user/project/file document store from PaperPage.
  Track stable file ID, base version/content, local text and acknowledged version.
  Keep drafts when switching files; retain a per-file editor state/undo/selection.
- [ ] Slice B ? Persist recovery drafts locally (IndexedDB candidate), namespaced
  by account and project. Restore through an explicit recovery prompt after reload;
  never silently replace newer server work. Explain browser storage limitations.
- [ ] Slice C ? Add debounced autosave (initial target: 1?2 seconds after typing
  stops), serialize saves per file and coalesce changes during an in-flight save.
  Keep Ctrl/Cmd+S as immediate save and add Save all for dirty documents.
- [ ] Distinguish Saving, Saved, Local only/offline, Save failed and Conflict.
  Include last acknowledged save time; typing stays responsive while saving.
- [ ] Slice D ? Preserve base/local/server versions on a conflict. Offer comparison,
  copy/download draft, reload after confirmation and a deliberate resolved save.
  Never retry an old full-file write as last-write-wins.
- [ ] Treat loss of access, archival, remote deletion and renamed files explicitly.
  Stop unauthorized writes; retain a user-visible recovery/export path only where
  authorized. Do not automatically send old offline edits after permission changes.
- [ ] Define sign-out/shared-device cleanup, retention and storage-full behavior.
  Proposed local recovery retention: seven days, with discard/clear controls;
  purge private cached text on sign-out after warning about unacknowledged work.
- [ ] Recompile/export identify all dirty files, not only the active one. Compilation
  must use one coherent snapshot; a failed save must not compile an older snapshot
  while claiming the user's latest text was included.

**Touches:** PaperPage state, SourceEditor lifecycle, paper API save coordinator,
local recovery module, relevant versioned RPCs/types and documentation. Extract
only enough structure for these behaviors; avoid an unrelated full rewrite.

**Acceptance:** Edit A and B, switch repeatedly, undo in each, reload and recover;
disconnect/reconnect; fail storage writes; interrupt a save; edit one file in two
sessions; demote/remove/archive during editing. No acknowledged edit disappears,
no account sees another account's cached text, and no conflict is silently overwritten.
**Not included:** full offline compilation, background sync after sign-out, CRDT or history UI.

## PAPER-06 ? Manuscript history and restore

**User story:** "Show me what changed since yesterday and let me bring back a
paragraph or deleted chapter without destroying today's work."

- [ ] Design server-authored history for content plus tree/main-file revisions,
  with actor/time and file identity retained across renames. Do not equate a
  per-file version integer or Activity metadata with recoverable history.
- [ ] Add named project checkpoints and a paginated history panel; distinguish
  automatic checkpoints from deliberate labels such as 'Advisor draft'.
- [ ] Show source diffs and file additions/deletions; preview old text without
  modifying the current editor. Download a selected snapshot.
- [ ] Restore a file or project as a **new** revision, with preview and confirmation;
  require a checkpoint before restore and preserve the current version.
- [ ] Handle draft conflicts and atomic tree restoration, including referenced
  figures. Historical figures cannot be cleaned up while retained history needs them.
- [ ] Define bounded automatic snapshot frequency, retention and storage quota
  before schema implementation; expose limits and eviction rules. Named snapshots
  must not be silently pruned. Do not store a full project per keystroke.
- [ ] Owner/member restore only in active projects; viewers inspect authorized
  history. Removed users lose access; research bodies never enter Activity logs.

**Acceptance:** Rename/delete/restore a chapter and figure, compare revisions,
restore under concurrent edits, test forbidden access, and verify the resulting
project compiles. Proposed retention values remain a design decision, not a promise.

## PAPER-07 ? Compilation users can understand

**User story:** "Tell me what broke, take me to it, and keep the last good PDF."

- [ ] Build a repeatable fixture corpus: single/multi-file articles, nested main,
  BibTeX, tables/math, PNG/JPEG, custom class/style, missing packages, bad syntax,
  missing citations, non-ASCII text, cancellation and resource/network failures.
- [ ] Bind every compile result to source/tree revision and main file. Keep the
  last successful PDF; label compiling, cancelled, failed, stale and warnings
  separately. A result must not overwrite newer-job state.
- [ ] Parse actionable errors/warnings with file/line where available; group repeated
  diagnostics and offer next/previous issue plus jump-to-source. Keep raw logs.
  For uncertain locations, show the raw context instead of guessing a line.
- [ ] Explain common bibliography failures: missing key, missing database/style,
  malformed entry and unresolved references. Distinguish warnings from fatal errors.
- [ ] Measure cold/warm compile and asset hydration. Improve caching only where
  isolation is preserved; never leak one project's auxiliary files into another.
- [ ] Keep cancellation/timeouts effective during preparation and engine execution.
  Offer a deliberate clean rebuild and retry; expose dependency-download failure.
- [ ] Publish a tested compatibility matrix: current pdfLaTeX/BibTeX path, supported
  asset types and known limitations. Unicode/system-font, XeLaTeX/LuaLaTeX/Biber
  support needs a separately accepted runtime/cost/security decision.
- [ ] Optional compile-on-save only after reliable manual compilation, disabled by
  default initially; debounce and queue at most the newest requested snapshot.

**Acceptance:** Every known failure has a usable message; fixing a flagged location
resolves its fixture; valid bibliography renders both citation and reference;
cancelling never loses edits. Record timings and browser/device/network conditions.
**Not included:** arbitrary shell escape or an unbudgeted server compile farm.

## PAPER-08 ? An editor that stays out of the way

**User story:** "Let me move around a long paper and write without repetitive clicks."

- [ ] Open-file tabs with dirty/conflict markers, close/reopen actions and restored
  cursor/scroll. Build on 05's document store rather than a second draft model.
- [ ] Files/Outline/Search sidebar modes; outline headings across supported input
  files, quick file switch, go-to-line and reveal current file. Handle recursive
  inputs and macros conservatively; do not promise a complete TeX parser.
- [ ] Expose existing find/replace; add project-wide search with path/line results.
  Multi-file replace requires preview and version-safe apply, respecting dirty drafts.
- [ ] LaTeX snippets and completion for common commands/environments; shortcut/help
  menu for bold/italic, section, list, equation, comment and compile. Insert source
  at the cursor with undo support; avoid rewriting unrelated formatting.
- [ ] Persist font size, wrap, indentation, split ratio, sidebar and focused-writing
  preference. Restore layout by user/device; handle small screens safely.
- [ ] Approximate source-aware word count labelled as approximate, not a publisher's
  authoritative count. Keep code/math/comments from inflating the obvious cases.

**Acceptance:** Keyboard-only navigation across a multi-chapter fixture; project
search opens exact results; snippets undo cleanly; switching theme/files preserves
cursor/history; no clipping at 375/768/1440px. Advanced spellcheck is follow-up work.

## PAPER-09 ? PDF reading and source navigation

**User story:** "Keep me on the paragraph I am fixing when I recompile."

- [ ] Preserve page/relative scroll and zoom across recompiles; clamp gracefully if
  the document becomes shorter. Add direct page entry, real zoom labels and fit modes.
- [ ] Add selectable/searchable PDF text, match navigation, safe links, page
  thumbnails/outline and lazy continuous scrolling with bounded canvas memory.
  Retain the accessible text alternative and genuine white paper in both themes.
- [ ] Prototype source-to-PDF and PDF-to-source mapping using actual engine output.
  Verify whether this SwiftLaTeX build can emit usable SyncTeX before committing
  to exact mapping. Test nested mains, included files and generated bibliography.
- [ ] Bind mappings to the compiled snapshot. Mark source/PDF differences and
  disable or qualify stale mappings. If exact mapping is unavailable, offer
  explicitly labelled text-search navigation, not fake SyncTeX behavior.
- [ ] Add optional separate preview window only after its authenticated state,
  update/disconnect and memory lifecycle are defined.

**Acceptance:** Recompile while reading page 8, shrink to 3 pages, search/copy text,
follow a citation link, zoom with keyboard, and test long-document memory use.
Exact mapping is a gated subfeature, not a prerequisite for the improved reader.

## PAPER-10 ? References that do not require guesswork

**User story:** "Find a citation by author/title and insert a key that really exists."

- [ ] Index existing .bib entries locally; show author/title/year/key and source file.
  Preserve raw BibTeX, including unfamiliar fields, strings and nested braces.
- [ ] Provide citation and label pickers at the source cursor; add completion for
  known citation/reference keys. Show missing and duplicate keys with locations.
- [ ] Import BibTeX with preview and duplicate-resolution choices. Rename a key only
  after showing affected supported citation commands; flag unsupported macros.
- [ ] Add common-entry editing and simple insertion help without making the visual
  form the only way to edit a bibliography. Leave advanced styles in source.
- [ ] Treat DOI lookup as a separately enabled slice: verify a provider, display
  source/provenance, handle failure/rate limits, and let users review metadata.
  No fabricated references or silent overwrites; manual entry always works.

**Acceptance:** Reproduce the greenwade93 case, repair it through the reference UI,
compile successfully, and verify duplicate/malformed/nested-brace fixtures.
DOI lookup must not transmit private manuscript text; Zotero/Mendeley sync is deferred.

## PAPER-11 ? Organize research assets and start quickly

**User story:** "Add a figure or chapter without breaking the document."

- [ ] Bring common create/rename/move actions closer to the existing tree. Add
  searchable paths, collapsible folders and keyboard equivalents for pointer actions.
- [ ] Preview known input/include/graphics/bibliography references before a rename;
  offer a version-safe multi-file update for supported literal paths only. Flag
  dynamic/macros for manual repair and preserve every draft.
- [ ] Upload/preview figures and insert a figure snippet with caption/label/path.
  Keep limits visible; validate collision, MIME/signature and dimensions.
- [ ] Optionally copy an authorized General Files asset into Paper as an explicit
  snapshot with separate quota accounting; never silently link mutable uploads.
- [ ] Improve existing ZIP review with conflict choices, entry-point detection and
  compatibility warnings. Imports must be recoverable using 06 checkpoints.
- [ ] Offer a small tested starter set: blank article, research report and multi-file
  thesis skeleton. Include working example bibliography/figure; no unlicensed
  publisher templates or overwrite of an existing paper without confirmation.

**Acceptance:** Import a supported project, rename an included chapter, insert a
figure, undo via restore and export/reimport. Warn about unsupported formats/engines.
PDF/SVG/EPS figure support needs an explicit conversion/compiler compatibility slice.

## PAPER-12 ? Coediting architecture proof (decision gate)

**User story:** "Before you call this collaborative, prove two authors cannot
silently overwrite each other."

- [ ] Compare a maintained CRDT approach (candidate: Yjs + CodeMirror binding) with
  the current versioned-write model. Record transport, hosting cost, persistence,
  operational complexity and migration decisions in DECISIONS before shipping.
- [ ] Prove two authenticated clients editing the same and different files, offline
  reconnect, duplicate/reordered messages, process restart and document hydration.
- [ ] Design trusted room admission, membership revocation, viewer restrictions,
  document-size limits and rate limiting. Realtime broadcast alone is not durable
  storage and client-side readonly is not authorization.
- [ ] Define one authoritative editing protocol; prevent old whole-file autosaves
  from overwriting shared documents. Design migration/rollback from 05/06.
- [ ] Define document/file IDs, rename/delete/restore semantics, checkpoint capture
  and a coherent compile/export snapshot while teammates continue typing.
- [ ] Measure candidate at 2 and 5 concurrent editors with representative documents.
  Stop and report if safety or operating budget is not viable; do not fake presence.

**Exit deliverable:** bounded prototype evidence, architecture decision and a
reviewable rollout plan. The runtime/dependency/provider choice is not pre-approved
by this roadmap. File locking may be an explicit interim mode, never labelled coediting.

## PAPER-13 ? Real simultaneous writing

**User story:** "My coauthor writes Methods while I fix Results; our work survives
reconnects, and I can tell who is actually here."

- [ ] Ship 12's accepted protocol behind a controlled rollout; migrate existing
  documents without discarding old history or recovery drafts.
- [ ] Live same-file text updates, actual participant presence/cursors/selections,
  accessible coauthor names/avatars and optional follow collaborator mode.
  Show presence timeout/disconnection honestly; do not infer online status from membership.
- [ ] Local undo affects my own actions, not a teammate's entire latest edit.
  Reconnect reconciles supported offline changes and reports rejected writes.
- [ ] Enforce revocation/demotion/archive while a session is open; shared file tree
  updates cannot resurrect deleted files or fork a document silently.
- [ ] Capture coherent compile/history/export snapshots while editing continues;
  avoid recompiling once per collaborator keystroke.

**Acceptance:** Two- and five-account scenarios, conflicting edits, dropped transport,
server restart, stale tab, renamed/deleted file, member removal and read-only viewer.
This XL increment must ship in slices: durable session ? simultaneous text ?
presence ? lifecycle/reconnect hardening. None substitutes for the final safety gate.

## PAPER-14 ? Advisor review and anchored comments

**User story:** "Leave feedback on this sentence and know whether it was addressed."

- [ ] Select source text to start a threaded comment; navigate between editor and
  thread. Resolve/reopen, filter unresolved and retain author/time attribution.
- [ ] Use stable anchors compatible with 13; when text is deleted or an anchor
  cannot be mapped, show detached/outdated context rather than moving it silently.
- [ ] Define comment permissions before rollout. Default proposal: owners/members
  comment, viewers read. Advisor commenting requires an explicit permission decision;
  a research-role label must never grant it automatically.
- [ ] Preserve comments through history/restore with documented anchor semantics;
  remove access for former teammates. Avoid public review links in this increment.
- [ ] Add suggestions/accept/reject as a later slice only after comment anchors and
  shared editing are stable. Acceptance/rejection must be version-safe and auditable.

**Acceptance:** Comment on a passage, concurrently edit/delete/move it, resolve and
reopen a thread, restore an earlier version and verify authorization. General
project Chat stays separate; review does not require leaving the paper workspace.

## PAPER-15 ? Submission and reproducible handoff

**User story:** "Give me the exact PDF and source I approved for submission."

- [ ] Preflight for fatal compile errors, unresolved citations/references, missing
  assets and placeholder/TODO text; group blocking errors vs reviewable warnings.
  Heuristic checks must be labelled and must not claim publisher compliance.
- [ ] Create a named submission checkpoint from one acknowledged project revision.
  Compile that snapshot and bind PDF, entry point, engine metadata and warnings to it.
- [ ] Export a clean source ZIP plus the matching PDF; include an optional manifest
  with snapshot ID and checksums. Preserve draft/export choices from current code.
- [ ] Allow clearly labelled draft export when warnings remain; do not block all
  downloads or silently substitute an earlier successful PDF.
- [ ] Validate export/reimport using supported projects and document reproducibility
  limitations of downloaded package versions; do not promise byte-identical output
  unless dependencies and toolchain are actually pinned.

**Acceptance:** Download, unzip, reimport and compile the same snapshot; compare
content/assets; verify stale PDF cannot be presented as the approved revision.
DOCX conversion, publisher submission APIs and GitHub sync remain separate work.

## PAPER-16 ? Release hardening and real-user pilot

- [ ] Repeat critical flows with beginner, experienced author and advisor users;
  record observed friction rather than invented satisfaction metrics.
- [ ] Keyboard/screen-reader review, visible focus, contrast, non-color-only status,
  reduced motion, touch targets and responsive controls across both themes.
- [ ] Test current Chrome/Edge/Firefox/Safari and mobile Safari/Chrome as available;
  report untested combinations. Verify large-paper scrolling and worker cleanup.
- [ ] Benchmark representative 10-page article, 50-page report and ~100-page thesis
  within existing quotas, including figures and bibliography. Use lazy rendering;
  document measured supported limits before increasing quotas.
- [ ] Exercise recovery, history, simultaneous edits, revocation, malicious ZIPs,
  quota exhaustion and package-server failure. Retest access to old snapshots/assets.
- [ ] Publish short onboarding, keyboard help, compatibility and recovery guidance.
  Mark unsupported features explicitly rather than providing dead controls.

**Proposed success targets (to measure, not current claims):**
- No silent data loss in the recovery/concurrency test matrix.
- A new user compiles the supplied starter within five minutes without assistance.
- A user locates and repairs a planted missing citation within two minutes.
- Recover a prior paragraph through History within one minute.
- Input-to-paint p95 under 100ms on an agreed reference laptop/fixture; warm simple
  article compile target under ten seconds. Record cold-network timings separately.
- Two authors finish a 30-minute session including reconnect with converged saved text.
These targets guide diagnosis; compiler/device limits must not be hidden to meet them.

## Definition of done for every build

- [ ] Scope/dependencies and permissions documented; follow existing security rules.
- [ ] Source/types/backend/storage changes delivered end-to-end where needed.
- [ ] Loading, empty, error/retry, read-only, offline/conflict states are truthful.
- [ ] Relevant local fixture/security tests and lint/build/diff checks pass.
- [ ] Manual happy path and the build's failure scenarios accepted; screenshots or
  observations recorded where visual behavior matters. Static checks alone are insufficient.
- [ ] Keep local vs hosted migration/deployment status explicit. No production
  deployment, service subscription or external invitation is implied by this plan.
- [ ] Update MEMORY and relevant canonical docs, then mark this build complete.

## Deliberately deferred

AI writing/review, generated citations, full visual/WYSIWYG editing, DOCX roundtrip,
public paper hosting, anonymous review, Git integration, external reference-manager
sync, publisher submission and advanced compile engines. These may be valuable,
but recoverability, writing quality and real collaboration come first.
Google Meet remains paused. Non-paper features receive only necessary regression fixes.

## Reference points, not a feature-parity promise

The roadmap is based primarily on Scholaris code and research-writing jobs.
Official Overleaf documentation helps check established interaction expectations:
[preview position/navigation](https://docs.overleaf.com/navigating-in-the-editor/working-with-the-pdf-viewer/pdf-viewer-options-and-navigation),
[source/PDF mapping and limitations](https://docs.overleaf.com/navigating-in-the-editor/working-with-the-pdf-viewer/moving-between-the-editor-and-pdf),
[history](https://docs.overleaf.com/writing-and-editing/history-and-versioning), and
[anchored comments](https://docs.overleaf.com/collaborating/commenting).
These references do not establish capabilities of the Scholaris engine or a
requirement to reproduce Overleaf's complete product.

## Previous delivery records

The records below describe previous builds, not the next paper implementation.

## Previous build: PROFILE-01 - Account profiles and shared chat avatars

Status: implemented locally; browser workflow acceptance pending.

- [x] Protected `/profile` route opened by the account badge.
- [x] Generated unique email-derived usernames; editable username/display name.
- [x] Persisted username/email badge preference, optional affiliation and bio.
- [x] Ten illustrated avatar presets, validated photo uploads and live preview.
- [x] Save/reload feedback, unsaved-change guard, stale-save rejection and password link.
- [x] Private avatar storage; current teammates may read only the saved avatar.
- [x] Same avatar in chat header, message bubbles and member sidebar; initials fallback for unavailable/former members.
- [x] Local migrations applied; lint/build/whitespace checks passed.
- [x] Rollback-only database checks passed for saves, stale writes and avatar access boundaries.
- [ ] Manual browser checks for photo upload, responsive layout and cross-account chat display.
- [ ] Apply migrations to hosted Supabase when deployment is authorized.

## Previous build: THEME-01 - Readable dark mode with animated theme switch

Status: implemented locally. All static checks and production builds passed;
manual visual workflow acceptance is pending with the user.

### Scope and Delivered Architecture

1. **Visual Direction: Charcoal with forest-green accents**:
   - Palette: Page `#101713`, Cards `#18221C`, Inputs `#202D25`, Text `#EDF3EE`, Secondary `#B5C3B8`, Accent `#95D5AC`.
   - Semantic tokens defined in `:root` and `[data-theme="dark"]`.
   - Focused dark-token tests pass: minimum text contrast 6.24:1 and control border 3.52:1. Whole-page visual acceptance remains pending.
2. **Animated Theme Switcher (`ThemeToggle`)**:
   - Track with 280ms cubic-bezier transition, smooth thumb slide, and icon rotation/fade.
   - Reduced-motion media query override (`prefers-reduced-motion: reduce`).
   - Integrated into AppShell (including Paper) and AuthLayout; duplicate Paper control removed.
3. **Theme State & Zero-Flash Initialization**:
   - Pre-hydration script `public/theme-init.js` sets `data-theme` and `colorScheme` before first paint.
   - Synchronized across tabs via `window.addEventListener('storage')`.
   - Graceful fallback for environments with blocked local storage.
4. **App-wide Coverage & Brand Wordmark Preservation**:
   - Dashboard, all project tabs (Overview shortcuts, Chat workbench, Files storage, Team, Tasks, Activity, Meetings, Settings), dialogs, and empty states.
   - Overview shortcut cards given dark charcoal surface (`#18221C`), crisp borders (`#35473c`), and clear contrast hierarchy with mint green accents (`#95D5AC`).
   - Hero banner milky white blur eliminated in dark mode via subtle emerald radial glow (`rgba(149, 213, 172, 0.07)`).
   - Wordmark inverted with grayscale/screen blending in dark mode, preserving the original asset while removing the white backing. Account identity uses a rounded pill.
   - Rounded SVG favicon embeds the existing PNG with transparent corners and a fresh URL.
5. **Paper Workspace Isolation**:
   - In-editor CodeMirror theme dynamically reconfigured via `Compartment` without editor destruction or cursor loss.
   - Custom LaTeX syntax highlighting in dark mode, including commands/meta tokens and brighter comments/gutters (`#a3b5a7`).
   - Strict preservation: rendered PDF canvas pages remain 100% white with original document colors.

### Implementation Checklist

- [x] Create theme store with `useSyncExternalStore`, storage sync, and `matchMedia` listener.
- [x] Add anti-flash initialization script `public/theme-init.js` before React mounts.
- [x] Define semantic light and dark CSS tokens in `src/index.css`.
- [x] Build animated `ThemeToggle` component with accessible focus rings and touch support.
- [x] Implement dynamic CodeMirror `Compartment` theme in `SourceEditor.tsx` with LaTeX syntax highlighting.
- [x] Add one `ThemeToggle` to the shared main/Paper header and auth layout.
- [x] Style all app surfaces, Overview shortcuts, dialogs, chat feeds, files table, and meetings in dark mode.
- [x] Invert the dark-mode logo, round the account badge, and add rounded favicon corners.
- [x] Apply the same account pill in light mode using light surface/border tokens and shared compact sizing.
- [x] Eliminate hero wave milky white blur in dark mode.
- [x] Preserve white background on compiled PDF pages and previews.
- [x] Run linting and production build (`npm run lint`, `npm run build` - 0 errors, 0 warnings).
- [x] Run focused theme preference/event/contrast checks; fix actual selector gaps across tabs.
- [ ] User performs manual workflow and visual verification in browser.

## Previous build: SETTINGS-01 - Project settings and recovery

Status: implemented locally. The scope below records the delivered
contract; manual workflow acceptance is still pending with the user.
Google Calendar/Meet work remains paused and is not a prerequisite for Settings.

## Follow-up: supplied branding

### Navbar refresh

- [x] Add a sticky glass header with an opaque fallback and existing brand palette.
- [x] Add Dashboard/Project/Paper navigation pills and a real account-initial badge.
- [x] Keep responsive navigation, accessible icon controls and compact Paper header.
- [x] Preserve sign-out errors, busy state and unsaved-change protection.
- [x] Verify lint, production build and diff whitespace checks (all passed).
- [ ] Manually review desktop/mobile appearance, scrolling and keyboard navigation.

Browser verification is pending: no browser was available to connect during this change.

### Logo and favicon

- [x] Connect the PNG favicon and shared wordmark on navbar, Paper header and auth pages.
- [x] Preserve the original assets; use responsive CSS framing for mockup margins.
- [x] Run lint, production build and diff whitespace checks (all passed).

Interactive visual acceptance remains with the user.

Favicon visibility follow-up: replaced the linked favicon with a tightly framed
`public/team-scholaris-favicon-v2.png`, preserving the original. Built-in image
editor prompt: enlarge the existing white book-and-leaves emblem, remove outer
white margins, and use an opaque forest-green background with a small inset.

## Implementation checklist

- [x] Inspect current SQL, lock order, grants, frontend API contracts and local changes.
- [x] Add settings revision and narrow owner-authorized management/recovery RPCs.
- [x] Enforce quota-safe creation/transfer/restore concurrency and retry receipts.
- [x] Add Settings route in the shared shell, read-only summary and General form.
- [x] Add archive/unarchive with cross-feature read-only enforcement.
- [x] Add eligible-member ownership transfer and role/invitation transitions.
- [x] Add confirmed soft deletion and owner-only Dashboard Trash.
- [x] Add server-authorized recovery window and restore into archived state.
- [x] Integrate Activity, dependent-view refresh and stale-access handling.
- [x] Review keyboard/mobile, drafts, error/retry and conflict handling in code; browser acceptance remains below.
- [x] Run authorized static checks and record results; user performs workflow acceptance.
- [ ] Complete the manual acceptance matrix below and record unresolved issues.
- [x] Update canonical docs and MEMORY with actual delivered/accepted status.

Verification record: the local migration `20260926000100_project_settings.sql`
was applied successfully without resetting existing data. `npm run lint` and
`npm run build`, `git diff --check`, documentation links and new-file whitespace
checks passed.
No workflow fixtures, real transfers/deletions, Google calls or hosted
deployment were performed. Manual acceptance remains pending.

## Current build: SETTINGS-01 - Project settings and recovery

Status: implemented locally; awaiting manual acceptance. Google Meet integration
remains paused at the user's request.

## Outcome

Project owners can edit project details, archive/unarchive, transfer ownership,
and move a project to recoverable Trash. Team members can see current settings
without gaining management permissions. Paper retains its independent layout.

## Existing foundations

- `projects` already has name, description, owner_id, status, and deleted_at.
- Name limit: 120 characters; description: 5,000 characters.
- Owner integrity uses a unique owner-membership index and deferred checks.
- `max_owned_projects()` currently returns five. Archived owned projects count;
  joined and soft-deleted projects do not. Creation already uses an advisory lock.
- Activity already recognizes details/lifecycle/ownership events. Reuse those
  triggers rather than generating duplicate events in the browser.
- Ordinary project reads exclude soft-deleted projects. Trash therefore needs
  a separate, narrow owner-only read path; do not weaken existing access rules.
- Frontend `PROJECT_RECOVERY_DAYS` is 30; the backend now enforces the matching
  window through `project_recovery_days()` and restore eligibility checks.

## User-facing scope

| Surface | Behavior |
| --- | --- |
| Settings tab | `/project/:projectId/settings`, inside ProjectTabShell, after Meetings and before Tasks |
| General | Edit name/description; display project ID, creation date, current owner, and status |
| Lifecycle | Archive an active project; unarchive a retained archived project |
| Ownership | Transfer an active project to an eligible current member with a dedicated confirmation |
| Danger zone | Move an active or archived project to Trash using typed-name confirmation |
| Dashboard Trash | Owner-only deleted-project cards, deletion/recovery dates, and Restore action |

Use a responsive settings form and a compact status/ownership sidebar. Keep
dangerous actions visually separated. On small screens, stack sections in the
same order. Show success near the action, field-specific validation, loading,
empty/error/retry states, and clear read-only explanations. Use native accessible
dialogs, named controls, keyboard focus restoration, and unsaved-edit guards.

### General details

Only the current verified owner of an active project can save. Trim names and
reject whitespace-only names; use the existing length limits. Save explicitly;
preserve drafts on network/conflict errors. Avoid changing updated_at or creating
history for a no-op save. Members and viewers see a read-only summary.

### Archive and unarchive

Archive confirmation explains that all retained research remains readable but
editing stops. Archive does not free an ownership slot. Team members may still
leave using the existing Team action. Pending invitations cannot be accepted
while archived; ordinary expiry still applies.

For an archived project, Settings offers owner-only Unarchive and Move to Trash;
details/transfer stay disabled until unarchived. Existing team, paper, files,
chat, tasks, and meeting content must remain intact across both transitions.

### Ownership transfer

- Active projects only. Select another current, verified `member`; viewers must
  first be promoted through Team. Never transfer to an outsider or to yourself.
- Show the recipient, the ownership-limit rule, and the resulting roles. Require
  typed project name and an explicit acknowledgement that management moves to
  the recipient. Transfer is immediate; acceptance/invitation workflow is outside
  this increment.
- In one transaction, change projects.owner_id, demote the old owner to member,
  and promote the recipient to owner. Preserve descriptive research roles and
  all historical contribution attribution.
- Enforce the recipient's current non-deleted owned-project quota server-side,
  including simultaneous create/restore/transfer requests.
- Revoke outstanding invitations from the previous ownership period. They must
  not become valid again if ownership later transfers back.
- Refresh Dashboard, Team, Settings, and Overview; remove the old owner's edit
  controls immediately after success. Old-owner stale tabs must fail server-side.

### Trash and restore

- Soft-delete only: retain research rows, storage objects, membership, and
  history. Revoke pending invitations; hide the project from normal dashboards
  and deny subsequent project reads/writes through existing access checks.
- Return the owner to Dashboard after deletion with a link to Trash. Other
  teammates cannot list the deleted project or its contents through Trash.
- Owner-only Trash RPC exposes only the metadata needed for recovery. Paginate
  retained records and distinguish recoverable from expired entries.
- Establish a server-authoritative 30-day recovery window, matching the existing
  UX constant. Return recover_until and restore eligibility from the server;
  never trust the browser clock to authorize restoration.
- Restore only if the caller still owns the record, the recovery window is open,
  and an ownership slot is available. Restore into **archived/read-only** state
  with an explicit confirmation explaining that retained team access returns.
  Owner can review the team before unarchiving.
- Preserve membership and research content; revoked invitations stay revoked.
- No permanent-delete button or automatic purge job in this build. After 30 days
  self-service restore expires; do not claim retained database/storage data has
  been physically erased. Storage quotas continue to account for retained data
  where applicable. Purge/retention enforcement needs a separate design.

## Permissions

| Action | Active owner | Member/viewer | Archived owner |
| --- | --- | --- | --- |
| Read settings | Yes | Yes | Yes |
| Edit details | Yes | No | No |
| Transfer ownership | Yes | No | No |
| Archive | Yes | No | Already archived |
| Unarchive | Already active | No | Yes |
| Move to Trash | Yes | No | Yes |
| List/restore Trash | Current owner only, subject to recovery window and quota | No | Same owner rules |

Verified authentication is required for all management mutations. Anonymous,
outsider, departed-member, stale-owner, and direct-table-write attempts are denied.

## Backend and frontend structure

Delivered feature files:

- `src/features/settings/SettingsPage.tsx`
- `src/features/settings/settings-api.ts`
- `src/features/settings/settings-types.ts`
- `src/features/settings/SettingsActionDialog.tsx`: lifecycle/transfer/recovery confirmations.
- `src/features/settings/ProjectTrash.tsx`: Dashboard Trash backed by the recovery RPC.
- `src/features/settings/useSettingsGuard.ts`: navigation, unload and sign-out guards.

Add project `settings_revision` for compare-and-swap mutation checks; do not use
updated_at as a settings revision because team actions also update it. Ensure a
single server-side mechanism advances that revision for managed fields even
when another trusted path changes them.

Delivered narrowly scoped RPCs (every mutation also takes `operation_id`; the
Trash list is read-only):

1. `update_project_details(project_id, expected_revision, name, description)`
2. `set_project_archived(project_id, expected_revision, archived)`
3. `transfer_project_ownership(project_id, expected_revision, recipient_id)`
4. `trash_project(project_id, expected_revision)`
5. `list_deleted_owned_projects(cursor, limit)`
6. `restore_project(project_id, expected_revision)`

Keep browser SELECT-only grants on projects and project_members. Mutations use fixed-search-path functions
with explicit role grants, input validation, current-owner checks, and atomic
changes. Use stable operation IDs for mutation retries, especially transfer:
after success the original caller is no longer owner, so a lost response must be
reconciled without performing a second transfer or issuing misleading denial.
Scope receipts to their authenticated caller, action, project, and input payload.

Implemented lock order: caller/operation lock, then distinct per-user quota keys
in sorted key order, then project row. Quota keys reuse the exact convention in
create_project. Ownership, revision and recipient membership are checked after
acquiring locks. Existing team/content operations never acquire quota locks after
their project-row lock. Receipts store a SHA-256 request digest and minimal result;
they are private to trusted functions. The fixed-action wrappers call an internal
helper with no browser execution grant. Unconfirmed browser requests keep their
original payload/operation ID and offer a safe same-request retry.

Refresh dependent views after success and on focus. Preserve unsaved forms rather
than replacing their data on focus. Treat unavailable access separately from
network errors. Clear cached project details when deletion/revocation is detected.

## Cross-feature behavior

- Reuse existing project Activity triggers for changes; retain lifecycle history
  so it becomes visible after restoration. Team transfer events may accompany
  the project ownership event, but do not duplicate either from client code.
- Audit paper/file Storage authorization as well as ordinary database RLS for
  archive/deletion. Already downloaded content cannot be recalled; existing signed
  links can remain valid until expiry. Do not promise immediate revocation of
  externally held links or copies.
- Archive/delete/transfer do not cancel Google events, end Meet calls, revoke
  Google access, or repair the paused integration. Explain this in confirmations
  when Google-linked meetings exist. Calendar ownership remains with its organizer.
- Google operations already in progress may finish externally during a lifecycle
  change; retain the existing reconciliation/error state and do not auto-retry
  against an archived/deleted project.

## Build order and acceptance

1. Database management/recovery RPCs, locking, revisions, and permission rules.
2. Settings route/shell, General form, archive/unarchive.
3. Ownership transfer and danger-zone confirmations.
4. Dashboard Trash and restoration, with quota/recovery feedback.
5. Activity/cache integration and cross-feature permission review.
6. Lint, frontend build, and whitespace checks; manual acceptance by the user.

Manual checks: owner versus member/viewer; archive read-only enforcement across
all tabs; simultaneous stale edits; network retries; transfer at recipient quota;
transfer versus project creation; deletion from two tabs; hidden/deleted direct
URLs and Storage reads; owner-only Trash; restore at quota; expired recovery;
preserved research and memberships; revoked invitations after transfer/restore;
mobile layout and keyboard/dialog behavior. Runtime workflow checks are left to
the user; static checks do not mark this acceptance complete.

## Manual acceptance record — pending

| Scenario | Expected result | Status |
| --- | --- | --- |
| Owner edits name/description; no-op save | Saved across reload; no duplicate history or revision for unchanged details | Pending |
| Member/viewer and outsider requests | Read-only for teammates; management denied server-side; outsider reads denied | Pending |
| Archive and unarchive across every tab | Retained reads, denied writes/invite acceptance while archived; data preserved | Pending |
| Two stale Settings forms | Losing save retains draft and reports conflict | Pending |
| Transfer with concurrent create/restore and full recipient quota | Exactly one owner; quota never exceeded; old owner becomes member | Pending |
| Lost response then retry same operation | One change/event; completed transfer/delete can be reconciled by original caller | Pending |
| Trash from two tabs and direct URLs/Storage | Normal access denied; only owner sees minimal Trash metadata | Pending |
| Restore within window, at quota, after expiry | Server enforces eligibility; eligible restore is archived with retained team/content | Pending |
| Pending invitations after transfer/Trash/restore | Revoked invitations never regain validity | Pending |
| Mobile, keyboard, dialog cancellation, reload/sign-out with drafts | Usable layout, focus restoration and unsaved-change guards | Pending |

Done means the full lifecycle works without manual SQL, every management action
is enforced server-side, and users can recover eligible projects through the UI.
Exclude account-wide preferences, billing, project templates, public sharing,
permanent purge, Google Meet fixes, and collaborative paper editing from SETTINGS-01.
