# Design system

## Live writing

Keep the project-bar Live writing action content-sized (32px minimum height).
Center the native dialog with explicit auto margins and viewport gutters. Before
joining, use a compact 680px dialog; expand to a large writing surface after joining.
Use compact Close, Start/Join session and End session buttons. Closing the window
and ending everyone's session remain distinct actions with explanatory tooltips.

Use a dedicated writing dialog for the pilot, opened from the selected source.
Show explicit sync/read-only/recovery status, Undo/Redo and Download draft. Connected
coauthors use their existing profile portraits with rings matching their cursor
color, one avatar per person, including yourself. Keep the same ordering across
viewers and identify yourself with '(you)' in hover/accessibility labels. Names remain in hover labels and accessible labels;
initials are a fallback while avatars load. Owner start/end are explicit actions. Recovery asks before
merging; failed/stale copies remain downloadable. Cursors use relative positions
with names as well as colors. Ordinary paper tools remain outside the dialog.

## Simplified Paper files

Lead with Upload files and Import ZIP. Show each path with Rename/Delete actions;
keep creation/templates/limits in disclosures. Delete all files explains its scope
and requires confirmation; changes persist only on Save changes. Cancel discards
the staged changes. Review filename conflicts explicitly, never overwrite silently.
Empty workspace must offer uploading and access to retained Paper history.

## Future shared-writing status contract

PAPER-12 is a prototype only. When integrated, show Saved only after a durable
acknowledgement; distinguish Syncing, Offline (local edits), and Access changed.
Never use project membership avatars as evidence of live presence. Undo must undo
only the current author's actions. Keep recovery/export available for rejected
local edits without offering a button that silently overwrites the shared paper.

## Equation composer

Insert > Insert equation opens a native modal with four labelled layout choices,
optional building blocks, a free-form LaTeX input and live preview. Numbered modes
expose optional labels; aligned mode explains & and row separators. Header/footer
stay visible while the body scrolls. Controls use theme tokens and small native
radio/checkbox inputs. Preview errors retain the user's text and offer an explicit
insert-source-anyway choice. Final numbering is determined by paper compilation.


## PAPER-11 asset workflows

Explorer keeps full-path search and collapsible folders; F2 opens file actions.
Rename/move has a preview with source paths, optional automatic repair and manual
warnings. Imports use explicit per-collision choices, never a global overwrite
checkbox. Templates enter the same review. Figure insertion has a labelled image
selector, preview, caption and unique label, with errors retained in the dialog.


## Reference assistance

Use Insert → Citation / Cross-reference and Tools → Manage references & check keys.
Pickers show title, author/year, literal key and source location with an explicit
Insert action. Disable ambiguous duplicate keys. The manager has labelled add/
import/edit/rename actions, a reviewed change preview and a direct Open source
path. Explain scan limitations and disabled actions; never imply TeX evaluation or
guaranteed bibliography inclusion. Match both themes, keep modal focus contained,
and allow Escape dismissal when no save is running.

PDF toolbar: chevron previous/next buttons surround a centered current/total page
box with spinner-free page entry. Show zoom once in the zoom selector, including
actual percentage for fit modes. Separate navigation, zoom and view tools with
subtle dividers; keep each group together when the toolbar wraps.

Compiler options use a distinct information header and full-width bordered action
buttons with icon, action title and short helper text. Disabled actions explain
why. Secondary compiler information is collapsed; buttons use visible hover/focus
states in both themes. Avoid styling actionable controls like informational prose.

Compilation reports prioritize outcome and action: a short status header, error/
warning counts, then expandable issues with plain titles and source locations.
Errors precede warnings. Keep full output in a separate Full log view, original
messages under Technical details, and revision/timings under Build details.
The header/close action remain visible above one scrolling body. Use themed
surfaces, amber warning icons and red error icons with text equivalents.

Successful PDFs remain the primary view even when TeX reports warnings. Keep the
warning count visible and provide a labelled Issues action; open diagnostics
automatically for errors only. Bound its height and include Close diagnostics.

## Compilation responsiveness

Warm the engine without blocking workspace editing. Keep package loading and
reference resolution progress visible during compile, and include actual pass
count in diagnostics timing. Compiler settings offer Restart compiler and rebuild
as a recovery action. Preserve the last successful preview while compiling; do not
claim instant cold compilation or hide real dependency download failures.


## Editor toolbar clarity follow-up

Use a single writing toolbar: File, Find & replace, Insert, Tools, Editor settings.
File contains opening, reopening and locating documents. Insert names outcomes
(Bold text, Bullet list, Math equation, Figure template). Tools contains Go to line,
Comment / uncomment lines and Search this text in PDF, with an explanation when
PDF lookup is unavailable. Settings presents labelled controls and a structured
shortcut list. Disclosures close on outside pointer input, focus departure or Escape.

Keep CodeMirror search above the source, with compact inline checkboxes, plain
labels, themed buttons and bounded height. Explicitly isolate its inputs/labels
from global application form styles. Menus fit the editor width and wrap gracefully
on narrow screens; avoid an additional persistent file-action row.


## PAPER-09: continuous reading

The reader is a continuous vertical document, never a single-page carousel. Page
arrows and direct page entry scroll within that document. Show true zoom percentage,
fit width/page, rotation, search and focus controls together. Keep paper white in
both themes. Text is selectable; selected search occurrences are highlighted.
Pages/bookmarks open in a compact navigator (overlay on narrow screens). Nearby
thumbnails provide orientation without rendering the full document at once.
Source lookup is labelled text search and unavailable for outdated PDFs. Maintain
an expandable text alternative. Browser acceptance is still required for alignment
and touch/keyboard interactions at 375/768/1440px.


## PAPER-08: writing controls

Use compact Files/Outline/Search sidebar modes and document tabs with dirty/conflict
markers. Put the collapse toggle immediately before the Explorer heading, with a
small left-side reopen control when hidden; keep collapse accessible in other sidebar
modes. Explorer controls belong with the sidebar rather than the project bar.
Open/reopen/reveal and editor tools remain small and theme-aware. Keep
search results labelled by path and line; disclose approximate outline/word counts.
Quick file switch supports arrows, Enter and Escape. Replacement uses a native
preview dialog with explicit apply, loading/error/blocked states and changed-source
blocks. Preserve full-width panes; small screens default to one pane and a hidden
sidebar. Font, wrapping, indentation and layout preferences persist per user/device.


## Compilation feedback

Distinguish compiling, cancelled, failed, outdated and successful-with-diagnostics.
Keep the last successful PDF visibly labeled after errors/cancellation. Diagnostics
offer previous/next issue, a repair suggestion, exact source links when reliable,
and expandable raw context/log. A PDF can exist despite BibTeX errors; never label
that as error-free. Keep timing/engine details inside the diagnostics/settings
disclosure. Do not introduce persistent status rows or decorative compiler cards.


## Paper history interaction

The compact project bar exposes History. Use an accessible native modal with a
paginated timeline and a separate comparison pane, stacking on narrow screens.
Distinguish automatic, named and protected safety snapshots. Show author, time,
main file and revision; preview source and tree changes without editing live text.
Diffs include explicit plus/minus markers and readable light/dark colors.
Restore requires confirmation and saved, conflict-free drafts. Preserve a visible
retry/error state and disclose retention limits; never imply every keystroke is a
historical checkpoint. Snapshot ZIP and deletion remain deliberate actions.


## Direction

Scholaris uses a light scholarly visual style: editorial serif headings,
legible sans-serif controls, restrained forest green, pale surfaces, and compact
research tools. Preserve the current implementation rather than introducing a
generic purple dashboard or a new component library. The original brief's
Linear/Notion/GitHub references describe clarity and practicality; the implemented
scholarly palette and typography now provide the concrete design language.

The implementation reference is [src/index.css](../src/index.css), together with
the shared layout and feature components. CSS has historical overrides; inspect
the final cascade before changing a token or copying an old declaration.

## Dedicated Paper surface

Use an opaque global header with content-driven height and 10px vertical padding,
followed directly by one compact project bar: back, truncated
project title, permission, save state, team avatars and actions/layout controls.
No second project-tab strip. No scattered destinations or permanent protection/
compiler footer. Keep warnings discoverable automatically and details in drawers.
Explorer starts at 220px, with a search field, nested tree and add menu. Both pane
separators support pointer and keyboard resizing. Editor documents have tabs;
active state uses a forest-green underline, not decorative cards. Compile is the
primary PDF-header action, alongside secondary export/log and compiler settings.
Use warm-white chrome, white code/PDF pages and a tinted preview canvas; all UI
surfaces and controls adapt to dark mode, but rendered PDF pages remain white.
Editor/PDF focus modes fill the browser viewport. Mobile uses Editor/PDF modes
and an overlay explorer. Do not add glass, fake online indicators, or dead controls.

## Typography and color

The user-supplied leaf/book logo is the current brand artwork.
`public/team-scholaris-icon.png` supplies the navbar and auth-page wordmark via
`BrandLogo`; CSS frames out the mockup's outer margins without altering the image.
`public/team-scholaris-favicon-rounded.svg` embeds the enlarged favicon PNG with
a rounded clip and transparent corners; the original PNGs remain unchanged.
Dark-mode wordmarks use CSS inversion/grayscale and screen blending to remove the
white mockup backing. Limit that effect to BrandLogo; never invert research media.
Use the same
wordmark on the compact Paper header, replacing the earlier generated S badge.
Keep the accessible image name and artwork proportions when adjusting sizes.
The account identity uses the same pill shape in both themes, with theme-specific
raised-surface, border and text tokens; compact screens reduce it to a circular badge.

| Role | Light mode | Dark mode (`[data-theme="dark"]`) |
| --- | --- | --- |
| UI/body font | Plus Jakarta Sans; system sans-serif fallback | Plus Jakarta Sans; system sans-serif fallback |
| Headings font | Newsreader; Georgia/Times serif fallback | Newsreader; Georgia/Times serif fallback |
| Monospace / Eyebrows | JetBrains Mono; monospace fallback | JetBrains Mono; monospace fallback |
| Paper source editor | Cascadia Code / Consolas / monospace | Cascadia Code / Consolas / monospace |
| Page background | `#fbfdf9` (`--bg-page`) | `#101713` (`--bg-page`) |
| Cards & panels | `#ffffff` (`--bg-surface`) | `#18221C` (`--bg-surface`) |
| Inputs & raised surfaces | `#ffffff` / `#f7faf7` | `#1a251e` / `#202D25` (`--bg-raised`) |
| Primary text | `#16261a` (`--text-primary`) | `#EDF3EE` (`--text-primary`) |
| Secondary text | `#4a5c4f` (`--text-secondary`) | `#B5C3B8` (`--text-secondary`) |
| Muted text & notes | `#697c63` (`--text-muted`) | `#a3b5a7` (`--text-muted`) |
| Accent & links | `#1f4331` (`--accent`) | `#95D5AC` (`--accent`) |
| Accent hover | `#173526` (`--accent-hover`) | `#b4e3c5` (`--accent-hover`) |
| Subtle / active background | `#eaf3ed` (`--accent-light`) | `#1e3327` (`--accent-light`) |
| Standard border | `#dfe6dc` (`--border-medium`) | `#35473c` (`--border-medium`) |
| Focus ring | 2px `#2f6549`, 3px offset | 2px `#95D5AC`, 3px offset |
| Destructive action | `#934137`, hover `#7a352d` | `#fca5a5`, background `#201514` |
| Compiled PDF pages | `#ffffff` (Strict document white) | `#ffffff` (Strict document white) |

`scripts/test-theme.mjs` verifies the dark primary/secondary/muted/accent/status
text tokens against page, card, raised, input and selected surfaces: minimum
6.24:1. The control-border token (`#718877`) has minimum 3.52:1 against those
surfaces. These are token checks, not whole-page accessibility certification.
`src/theme/theme-accessibility.css`, loaded after index.css, covers secondary
states, actual feature selectors, inline avatar palettes and Paper controls.

Typical heading sizes are 1.85rem for h1, 1.35rem for h2, and 1.15rem for h3;
reuse component styles for specialized workspace headings. Font resources are
currently loaded from Google Fonts by `index.html`; fallbacks must stay usable.
Do not convey permissions, validation, status, or danger solely through color.

## Layout contract

- `AppShell` provides the application header and outlet.
  The header stays sticky at the top, with forest-tinted translucent glass,
  backdrop blur and an opaque fallback. Navigation pills link to Dashboard and,
  inside projects, Project and Paper. Account initials come from the signed-in
  email; do not imply presence or add inactive notification/search controls.
  Small screens use a second navigation row and compact account/sign-out controls.
  Paper keeps a single compact header row on small screens. Keep the header below
  dialogs and the keyboard skip link above it; account for it in scroll offsets.
- Every ordinary project tab uses `ProjectTabShell`: one back link, one project
  hero with status, and one tab navigation. Add new tabs to this shared shell.
  Do not copy the header into each feature or reintroduce duplicate navigation.
- **Paper is the exception:** its outer workspace fills the available width and
  viewport beneath the application header. No centered outer margin or outer
  max-width cap. Source/PDF panes, divider, file explorer, and toolbar share space.
  Reading-width constraints on ordinary pages and dialogs remain appropriate.
- Preserve consistent page gutters and vertical rhythm. Use a small spacing
  scale (4/8/12/16/24/32px) for new work rather than isolated arbitrary gaps.
- Cards generally use subtle borders, about 12px radius, restrained shadows,
  and clear headings. Avoid stacking decorative cards around every control.
- On narrow screens, stack columns, allow tabs to remain reachable, wrap long
  names, and prevent page-level horizontal overflow. Paper offers Source/PDF
  modes and a file overlay instead of squeezing both panes indefinitely.

## Components and interactions

Use existing `.button` primary/secondary variants and feature-specific danger
styles. Primary actions use green; secondary actions use a neutral surface and
border. A destructive action needs specific wording and a confirmation that
explains its effect. Compact actions stay content-width; form actions can use
the existing full-width pattern. Disabled/loading buttons must not submit twice.

Use existing Lucide icons, with text for important actions and accessible names
for icon-only buttons. Avoid emoji/icon duplication, new illustration assets,
or controls that look enabled but do nothing.

Forms need persistent labels, field-level validation, useful examples, and
nearby save/error feedback. Native dialogs should fit the viewport, scroll their
content as needed, preserve visible actions, restore focus, and support Escape
when safe. Guard dismiss/navigation when there are unsaved changes. Keep typed
input on validation, authorization, network, and conflict failures.

Chat's composer starts compact, aligns text and Send, and grows only with input
up to a bounded height. Preserve Enter to send, Shift+Enter for newline, IME
composition safety, the 4,000-character counter, and per-channel drafts. Do not
restore the oversized pill-shaped empty textarea. Messages retain whitespace,
wrap long text, and use actual sender/time/connection information.

Paper needs visible saved/unsaved/conflict/compile/stale states, cancelable work,
keyboard-accessible resizing, and a retained last successful PDF after errors.
An old PDF must not look like a successful compilation of new edits.

## Required UI states

Every data-driven surface needs loading, empty, filtered-empty where relevant,
error/retry, success, permission-denied/unavailable, and archived/read-only states.
Failed counts must display unavailable, not a misleading zero. Unavailable
records must not leave stale sensitive content or broken action links visible.

Distinguish connection availability from user authorization. For paused Google
integration, do not imply a connection succeeded merely because a callback URL
or backend configuration exists. Keep ordinary meeting workflows understandable.

## Accessibility and review

Use semantic landmarks, heading order, labels, `aria-current` for active tabs,
accessible status announcements, visible focus, and keyboard-operable controls.
Focus outlines must survive component overrides. Explain errors in text and
avoid relying on hover alone. Keep touch controls comfortably usable and check
contrast, zoom, long content, and reduced-motion preferences when adding motion.

Review at 375px, 768px, and 1440px, plus wide desktop for Paper. Check keyboard
navigation, dialog focus return, 200% zoom, loading/error states, and actual
owner/member/viewer variants. These are acceptance targets, not a claim that
every current screen has passed an accessibility audit.

## Profile and avatar presentation

The account pill opens the profile editor. Use themed cards and inputs, a live
badge preview, a responsive grid of ten circular illustrated avatars and a
single-column mobile layout. Artwork palettes stay consistent in either theme.
Use the same saved avatar in navbar, chat header, messages and member sidebar.
Keep initials for unavailable/former members, and a preset fallback for failed
photo loads. Preserve accessible labels, selected states and visible focus.
