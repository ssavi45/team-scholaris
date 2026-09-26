# Design system

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

## Typography and color

The user-supplied leaf/book logo is the current brand artwork.
`public/team-scholaris-icon.png` supplies the navbar and auth-page wordmark via
`BrandLogo`; CSS frames out the mockup's outer margins without altering the image.
`public/team-scholaris-favicon-v2.png` supplies the browser favicon with enlarged
artwork and no outer white margins; the original `team_scholaris_favicon.png` is
preserved as source artwork. Use the same
wordmark on the compact Paper header, replacing the earlier generated S badge.
Keep the accessible image name and artwork proportions when adjusting sizes.

| Role | Current value |
| --- | --- |
| UI/body | Plus Jakarta Sans; system sans-serif fallback |
| Brand and editorial headings | Newsreader; Georgia/Times serif fallback |
| Eyebrows and supporting monospace UI | JetBrains Mono; monospace fallback |
| Paper source editor | Cascadia Code / Consolas / monospace, 13px in SourceEditor |
| Primary green | `#1f4331` (`--scholar-green`) |
| Primary hover | `#173526` |
| Pale green surface | `#f3f7f4` |
| Standard border | `#dfe6dc` |
| Body text / page | `#1a1a1a` / white |
| Heading colors | `#16261a` and `#1e3524` |
| Eyebrow | `#697c63`, uppercase, approximately .72rem, .08em tracking |
| Focus ring | 2px `#2f6549`, 3px offset |
| Existing destructive action | `#934137`, darker hover `#7a352d` |

Typical heading sizes are 1.85rem for h1, 1.35rem for h2, and 1.15rem for h3;
reuse component styles for specialized workspace headings. Font resources are
currently loaded from Google Fonts by `index.html`; fallbacks must stay usable.
Do not convey permissions, validation, status, or danger solely through color.

## Layout contract

- `AppShell` provides the application header and outlet.
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
