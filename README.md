# Team Scholaris

Team Scholaris is a private research workspace for university students, paper
teams, and small labs. Teams can write a LaTeX paper, share research files,
discuss work, assign tasks, and organize meetings in one project.

The application uses React, TypeScript, Vite, and Supabase. The paper editor
compiles LaTeX in the browser. Local development is the current reference
environment; a production frontend deployment is not yet established.

## Current status

Authentication, projects, invitations, team management, paper editing/compilation/
export/import, files, chat, overview, tasks, activity, and basic meetings are
implemented. Google Calendar/Meet integration is **paused and not accepted**:
the local browser connection has an unresolved credentialed CORS failure.
**SETTINGS-01 is implemented locally and awaiting manual acceptance.** Project
Settings now includes details, archive/unarchive, ownership transfer and Trash;
Dashboard Trash restores eligible projects into archived mode. See [current state](docs/MEMORY.md)
and the [single build tracker](task.md).

## Local setup

### Optional PAPER-13 transport pilot

Live writing is an optional local pilot. The durable-session/socket backend and
frontend provider can be tested with generated fixtures after applying local migrations:
`npm run test:shared-sessions` and `npm run test:shared-transport`.

For backend development, copy [the server example](server/coediting/.env.example)
to `server/coediting/.env.local`, configure backend-only credentials and explicit
allowed origins/project IDs, then run `npm run dev:shared-transport`. Set frontend
`VITE_PAPER_SHARED_URL=ws://127.0.0.1:5440/paper-shared` and refresh Vite. Select a
source file, choose Live writing, and have the owner start its shared session.
Others can connect to the same file. Close live writing to compile saved text;
end the shared session before renaming/deleting/restoring files. Empty allowlist
denies all project access. The default listener is loopback port 5440; remote binding requires TLS
certificate/key paths. No secrets belong in Vite configuration. The protocol is
documented in [Architecture](docs/ARCHITECTURE.md). The transport uses
[ws](https://github.com/websockets/ws/blob/master/doc/ws.md).

### Application setup

Use Node.js 24 and npm with the committed lockfile, plus Docker Desktop for
local Supabase. Run commands from the repository root.

```powershell
npm ci
npx --no-install supabase start
npx --no-install supabase migration up --local
```

On first setup only, copy [.env.example](.env.example) to `.env.local` without
overwriting an existing configuration. Set:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable or legacy anon key>
VITE_GOOGLE_AUTH_ENABLED=false
```

Get the browser-safe key from your local Supabase configuration/status. Status
output also contains privileged credentials: never paste the whole output into
documentation, frontend configuration, or commits. The public key variable accepts
both `sb_publishable_...` and legacy JWT keys declaring the `anon` role. Secret
and service-role credentials must never enter any `VITE_` variable.

For invitation email delivery, copy
[the function environment example](supabase/functions/.env.example) to
`supabase/functions/.env.local` on first setup. Its default Mailpit configuration
captures local email. Google fields may remain empty while that work is paused.
Keep this command running in a separate terminal:

```powershell
npx --no-install supabase functions serve send-project-invitation --env-file supabase/functions/.env.local
```

Start the frontend:

```powershell
npm run dev
```

| Service | Local address |
| --- | --- |
| Frontend | http://127.0.0.1:5173 |
| Supabase API | http://127.0.0.1:54321 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit | http://127.0.0.1:54324 |
| PostgreSQL | `127.0.0.1:54322` |

Open verification/reset links from Mailpit in the same browser and origin that
started the auth flow. Mailpit does not deliver messages to real inboxes. Local
and hosted Supabase users/data are separate. Do not reset the database to apply
pending migrations. Missing backend configuration displays a configuration state;
it does not simulate a working login.

## Commands and verification

```powershell
npm run lint
npm run build
git diff --check
```

`npm run preview` serves the production frontend build locally. There is no
`npm test` script: existing focused checks live in `scripts/test-*.mjs`.
[TEST_PLAN.md](docs/TEST_PLAN.md) describes prerequisites, manual acceptance,
fixture effects, and which checks apply to each feature.

## Documentation

| Document | Purpose |
| --- | --- |
| [PRD](docs/PRD.md) | Product problem, users, requirements, scope, and success criteria |
| [Architecture](docs/ARCHITECTURE.md) | Runtime, data model, folder structure, integrations, deployment boundaries |
| [Design](docs/DESIGN.md) | Current visual system, shared shell, paper exception, interaction conventions |
| [Test plan](docs/TEST_PLAN.md) | Verification commands and acceptance scenarios |
| [Security](docs/SECURITY.md) | Trust boundaries, permissions, secrets, uploads, release requirements |
| [Decisions](docs/DECISIONS.md) | Durable decisions and departures from the original brief |
| [Memory](docs/MEMORY.md) | Current implementation, acceptance evidence, known issues, next handoff |
| [Development rules](RULES.md) | Contributor and AI working rules; Cursor adapters in `.cursor/rules/` |
| [task.md](task.md) | The only build task tracker; update it for the next authorized increment |

The actual folder structure is documented in Architecture. Tests stay in
`scripts/`; no parallel `tests/` framework is introduced by this documentation.
Both environment examples contain placeholders only. `.gitignore` excludes local
environment files, dependency directories, build output, and logs.

## Hosted environment

A hosted Supabase project exists, but local migration history is not proof that
the hosted database is current. Before deployment, inspect the target migration
history and proposed changes, configure Auth URLs and function secrets, review
storage/RLS, and complete the release checks in the test and security documents.
Frontend hosting remains undecided; it must serve SPA deep links and compiler
assets correctly. Google sign-in configuration and Calendar authorization are
separate integrations. Neither is enabled merely by connecting a GitHub repository.
