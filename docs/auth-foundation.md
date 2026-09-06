# AUTH-01 frontend foundation

The repository audit found React 19, TypeScript 6, Vite 8, Tailwind 4 (with the Vite plugin), React Router 8, Supabase JS, and the Supabase CLI already installed. No dependency installation was needed. The existing app was a heading with no router, client, or environment files. Supabase has generated CLI configuration but no migrations or seed file. No backend credentials were found in environment files or relevant process variables. No backend connection has been verified and Docker was not started.

## Current boundary

This increment is frontend structure only. Authentication controls are disabled and cannot submit credentials. Adding environment variables does **not** enable authentication. Login, registration, reset, and callback routes explicitly explain this. No fake sessions or application data are created.

The protected route deliberately denies all access by redirecting to login. The application shell, dashboard, and project page are placeholders behind it; they are not preview routes. Supabase session integration will replace this boundary in the next increment. Frontend route protection never replaces database RLS.

Incoming query parameters are retained when moving between auth forms, and protected routes retain the original path/query in `next`. This is navigation plumbing only: secure invitation persistence across signup/OAuth, redirect validation, and server-side invitation acceptance are still outstanding.

`src/lib/supabase.ts` prepares an optional client when configuration is valid. It is not imported into the application yet, so this preview makes no auth calls or callback exchanges. Environment validation accepts publishable keys and legacy JWT keys whose declared role is exactly `anon`. It rejects secret keys, service-role JWTs, other/missing roles, and malformed credentials. JWT inspection is not signature verification and does not establish authenticity, connectivity, or whether the key belongs to the project. Validation cannot keep a secret out of a Vite bundle: never put a secret in a `VITE_` variable.

## Run and check

```powershell
npm install # only if dependencies are not already installed
npm run dev
npm run lint
npm run build
```

Open the URL printed by Vite (normally http://localhost:5173).

1. `/` redirects to `/login`. Confirm the unavailable-auth notice and disabled Google, email/password, and sign-in controls.
2. Follow Create account. Check Name, Email, Password, Confirm password, and the verification note. Follow Back to sign in and Forgot password.
3. Open `/project/example?invite=sample-context`. It redirects to login with `next` preserved. Moving to register and reset retains that query. `/app` also redirects. No project content is exposed.
4. Open `/auth/callback`. It explains that callback integration is pending and does not claim success.
5. Open an unknown URL. Check the 404 and return link. Refresh each public route.
6. Check the forms at a narrow mobile window and navigate links with Tab/Enter. Disabled controls should not accept credentials.
7. Optionally copy `.env.example` to `.env.local`. Start with blanks, then malformed values; restart Vite each time. Pages should remain usable with a helpful development setup notice. Do not use real secrets as test inputs.

## Next increment: connect a hosted development backend

Use `.env.local` for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep this variable name for either a publishable (`sb_publishable_`) key or a legacy `anon` JWT key from your hosted development project or local Supabase CLI stack. Local development normally uses `http://127.0.0.1:54321`; loopback HTTP URLs are accepted, while remote URLs require HTTPS. Copy only the public key supplied by your project; never use service-role/secret keys or JWT signing secrets in any frontend variable. See [Supabase's API key documentation](https://supabase.com/docs/guides/getting-started/api-keys) for public versus privileged credential types. Adding configuration still does not connect authentication.

Before implementing or testing real auth, configure the hosted project: enable email verification, set the site URL to the actual frontend origin, allow the exact `/auth/callback` redirect URL, and configure Google OAuth. The generated local CLI configuration currently uses port 3000, disables email confirmations, and references a nonexistent seed file; it has been preserved and is not suitable for the acceptance flow as-is. Hosted settings are configured separately. Production hosting will need SPA fallback to `index.html` for direct routes.

Then implement verified session loading/error states, registration/login/logout, Google OAuth, callback handling, password recovery, profile creation with RLS, and pending invitation preservation. Test against the real backend. AUTH-01 and Milestone 1 are **not complete** until their real acceptance flows pass.

## File inventory

Created: `.env.example`; this document; `src/app/router.tsx`, `src/app/status-pages.tsx`; `src/components/layout/AppShell.tsx`; `src/features/auth/{AuthLayout,AuthPage,AuthCallbackPage,ProtectedRoute}.tsx`; `src/features/projects/{DashboardPage,ProjectPage}.tsx`; `src/lib/{env,supabase,constants}.ts`.

Modified: `src/App.tsx`, `src/index.css`, `index.html`, `.gitignore`, `README.md`. Existing package, Vite, and Supabase setup changes were preserved.

## Verification results

`npm ls --depth=0` confirmed all required dependencies. `npm run build`, `npm run lint`, and `git diff --check` passed. The initial sandboxed Vite build/dev attempts failed with `spawn EPERM` and a native-module loading error; both succeeded outside the sandbox without package changes. The development server returned the application entry point for all eight tested route URLs. This HTTP check does not verify client-side rendering or redirects. Browser verification was unavailable because no browser was connected; the manual UI checks above remain to be performed. No backend acceptance tests were run.
