# Team Scholaris

Local Supabase authentication is connected: registration, email verification,
login, password recovery, persistent sessions, and logout. Google OAuth still
requires provider credentials. PROJECT-01 adds a real dashboard, project creation,
and private project overviews with database-enforced ownership and limits.
See [PROJECT-01](docs/project-01.md) for behavior and acceptance tests.
INVITE-01 adds owner invitations, local email delivery, verified acceptance,
and shared team access. See [invitation setup and tests](docs/invite-01.md).
PAPER-01 adds a single-user LaTeX source editor with versioned saves and a file tree.
See [paper workspace setup and tests](docs/paper-01.md).
PAPER-02 adds browser-side LaTeX compilation, PDF preview, and a full-width editing layout.
See [compilation and preview](docs/paper-02.md) for usage, requirements, and tests.
PAPER-03 adds PDF and source ZIP downloads through the paper toolbar's **Export** action.
See [paper exports](docs/paper-03.md) for snapshot and unsaved-draft behavior.

With Docker Desktop running, run `npx --no-install supabase start`, then
`npm run dev`. Open http://127.0.0.1:5173. Local verification/reset emails
appear in Mailpit at http://127.0.0.1:54324.

See [the setup and manual test guide](docs/auth-foundation.md) for environment
configuration, validation commands, Google OAuth setup, and remaining work.

## Original Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
