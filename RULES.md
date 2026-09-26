# Team Scholaris development rules

## Scope and sources of truth

Follow the current user request and applicable higher-priority instructions.
These rules guide project work; they do not override explicit user scope or
authorize a new feature, deployment, message, paid service or destructive action.

Before changing code, read [MEMORY](docs/MEMORY.md), [task.md](task.md), and the
relevant sections of [PRD](docs/PRD.md), [Architecture](docs/ARCHITECTURE.md),
[Design](docs/DESIGN.md), [Security](docs/SECURITY.md), and
[Test plan](docs/TEST_PLAN.md). Inspect the actual implementation, final file
contents, package manifest, migrations and Git status. Do not infer bugs solely
from a diff or treat an old plan as delivered functionality.

## Implementation

- Build only the authorized increment. Plan substantial changes before editing.
  Resolve routine reversible choices from repository context; ask only for
  information or consequential decisions that cannot be inferred.
- Preserve user edits and unrelated work. Do not regenerate the application,
  reset databases or rewrite applied migration history to simplify development.
- Use TypeScript and existing dependencies/components. Keep functions focused,
  avoid duplicated business logic, and explain significant architecture or
  dependency changes before introducing them.
- Keep UI in feature components, data access in feature API modules and trusted
  authorization/invariants in the backend. Synchronize database types with SQL.
- Reuse ProjectTabShell for ordinary tabs. Keep Paper full-width and independent.
  Follow the existing fonts, palette, icons, spacing and form patterns.
- Include loading, empty, error/retry, read-only and unavailable states. Preserve
  drafts on errors/conflicts and reject stale async results. Never invent data,
  activity, presence, read receipts or successful integrations.
- Keep Google Meet fixes paused until the user resumes them. A future product
  goal is not permission to start its implementation.

## Security and data

- Never put privileged credentials in frontend code or any VITE_ variable. Public
  Supabase publishable/anon keys are intentional browser configuration; distinguish
  them from secret/service-role credentials.
- Enforce identity, verified email, current membership, access level, project
  state, quotas and revisions in trusted operations. UI checks are additional UX.
- Validate uploads/imports and retain private Storage/reference protections.
  Keep generated history minimal and server-written. Research labels grant no
  permissions. Do not bypass RLS to make a screen work.
- Review lock ordering and retry behavior for multi-row mutations. Preserve the
  exactly-one-owner invariant and original contributor attribution.
- Never expose secrets or token-bearing URLs in diagnostics. Keep environment
  values private; examples use placeholders. Do not send real invitations or
  create external calendar events without task authorization.

## Verification and Git

Use the focused checks in TEST_PLAN for the changed behavior. Respect a user's
manual-testing instruction and report checks not run. Static checks do not imply
browser/backend acceptance. For application changes, run appropriate lint/build/
whitespace checks; for documentation-only changes, verify links and consistency.
Do not add redundant tests for trivial reversible edits.

Review the final diff, keep commits focused and descriptive when committing is
authorized, and do not push/deploy merely because code is ready. Preserve local
and hosted environment separation. Never claim a migration was deployed or a
test passed without observing it.

## Documentation maintenance

Keep exactly the seven canonical Markdown documents in docs. Root `task.md` is
the only build task tracker: update it for the next authorized build, with scope,
implementation steps, permissions, verification and acceptance state. Do not add
TASKS.md, per-feature task files or another next-build document.

After a build, update MEMORY with current state, evidence, known issues and next
handoff. Record durable changed decisions in DECISIONS and relevant product/
architecture/design/security changes in their canonical documents. Keep plans,
implemented behavior and accepted behavior distinct. Cursor rules are concise
adapters to this file, not a second contradictory rulebook.
