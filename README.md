# Prompt Studio · Week 8 Prompt Chain Tool

A standalone Next.js / TypeScript App Router application in `sage-nyc-prompt-chains`, independent of `Hello-World` and `sage-nyc-admin`.

## Implemented

- Responsive workspace with Prompt Chains, Chain Editor, Run History, and Settings.
- Persistent light, dark, and system themes.
- Google sign-in through Google Identity Services (GIS) and server-side Supabase Auth token exchange.
- Server-verified Google identity **and** `profiles.is_superadmin === true` required for every workspace page and protected API.
- Login, loading, access-denied, authentication-unavailable, and sign-out states.
- Guarded chain and step CRUD, optimistic revisions, safe deletion, and atomic step reordering through the reviewed database RPCs.
- Server-side Gemini execution with per-step leases, idempotent run enqueueing, immutable snapshots, output artifacts, and run history.
- Polished execution history with expandable step results, output copying, and explicitly confirmed Superadmin-only history deletion actions. The deletion RPC proposal is kept separate for manual review.
- Mocked security tests remain offline; real Supabase and Gemini calls require explicit development configuration.

## Local setup

Use Node.js 24 LTS and npm.

```sh
npm ci
npm run dev
```

Visit `http://localhost:3000/login`. With no configuration, the login page explains that authentication is unavailable; the protected workspace stays inaccessible. `.npmrc` keeps npm's cache inside this project. No external fonts are downloaded at build time.

```sh
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm start
```

Tests prohibit unmocked fetch calls and use synthetic credentials. They exercise policy, page/API guards, proxy refresh/redirect behavior, Google callback validation, sign-out, scoped role lookup, and CSRF rejection. They do not verify real provider configuration, browser cookie behavior, or database policy correctness.

## Authentication setup — not performed yet

Do not connect this application to production until its configuration and database access have been reviewed. Do not copy another application's environment file. Create this project's own ignored `.env.local` only when ready to test against an approved **non-production** Supabase project.

`.env.example` lists names with empty values only:

| Variable                               | Purpose                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AUTH_ENABLED`                         | Explicit opt-in; only the literal `true` enables auth clients. Leave unset until reviewed.                         |
| `APP_ORIGIN`                           | One exact trusted origin, including port when applicable; no path or trailing slash. HTTPS required in production. |
| `APP_ALLOWED_ORIGINS`                  | Optional comma-separated exact deployment origins; no wildcards.                                                   |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`         | Google Web OAuth client ID; public, never a client secret.                                                         |
| `NEXT_PUBLIC_SUPABASE_URL`             | Approved Supabase project's HTTPS URL.                                                                             |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public key for session authentication.                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server-only key, used exclusively for the narrow Superadmin flag read. Never prefix it with `NEXT_PUBLIC_`.        |
| `GEMINI_API_KEY`                       | Server-only Gemini API key used by the execution route; never expose it with `NEXT_PUBLIC_`.                       |

Setup checklist for the approved test environment:

1. Configure a Google Web OAuth client. Register the exact app origin under authorized JavaScript origins and `<APP_ORIGIN>/auth/callback` as the authorized redirect URI for the GIS redirect flow. Configure the consent screen and test users as applicable.
2. Enable Google in the approved Supabase Auth project, using the matching Google client ID. Configure any provider client secret **in Supabase's dashboard**, not in browser code. Keep nonce validation enabled. This application uses `signInWithIdToken`, not the Supabase OAuth redirect flow.
3. Review the existing `public.profiles` schema. This implementation expects `id` to identify the corresponding Auth user and `is_superadmin` to be a boolean. Verify unique IDs, user/profile provisioning, RLS and column privileges. Ordinary users must not be able to promote themselves by changing `is_superadmin` through any other API. No migration or role-grant code is supplied or executed here.
4. Have an authorized administrator prepare an approved Google test user with a true flag and a separate ordinary test user. Confirm that a missing profile denies access. First sign-in can create an Auth user and run existing project triggers, so use a reviewed non-production project.
5. Supply this application's environment values and set `AUTH_ENABLED=true`. Restart the app after changes; public environment values are embedded in the client build.
6. Use HTTPS for real browser authentication testing, including local testing (`npm run dev -- --experimental-https` with a browser-trusted certificate). The temporary nonce cookie is `Secure; SameSite=None` so it accompanies Google's cross-site callback POST. Plain HTTP can display the unconfigured shell but is not a supported end-to-end authentication test environment.
7. Verify Superadmin access, ordinary-user denial, missing-profile denial, expiry/refresh, flag revocation, sign-out, browser-back behavior, and isolation from the other apps. Verify production HTTPS and exact origins separately before any deployment.

The app does not grant roles, alter Google/Supabase settings, apply SQL, or access any database while auth is disabled.

## Security architecture

The architecture selectively adapts the Admin app's verified-identity policy, server-only SSR sessions, and scoped service-role authorization read. No environment values or credentials were read or copied.

- `src/lib/auth/policy.ts` accepts an identity returned by Supabase `auth.getUser()`. Both the server-managed Google provider and Google identity must be present. Client metadata, body fields, query parameters, and `getSession()` are never authority for roles.
- `superadmin.ts` uses a private, nonpersistent service-role client to read **only** `profiles.is_superadmin`, filtered by the verified Auth user ID. Missing/false/nonboolean flags deny access. Errors fail closed with a sanitized 503. This is an authorization lookup, not a general data client.
- `src/proxy.ts` refreshes cookies and denies access by default, including unknown API paths. Only explicit login/auth/error endpoints and framework static resources are public. Refreshed cookies survive redirects and API errors. Responses use `private, no-store`.
- Each workspace page and its layout also call `requirePageSuperadmin()`. APIs must independently call `requireSuperadmin()` before touching data. `/api/session` demonstrates this and returns only the verified ID. Proxy is not the sole security boundary.
- API denials return JSON 401 (missing/invalid identity), 403 (wrong identity/role), or 503 (unconfigured/unavailable auth). Browser pages redirect to dedicated login/denied/error views. Google form callbacks use fixed 303 destinations for a usable browser error state; invalid callback destinations return an error response.
- Role checks are not cached across requests. Revoking the database flag blocks the next server request; already rendered content cannot be erased remotely without a new request.
- Session cookies use the distinct `sage-prompt-chains-auth` name (plus Supabase chunk suffixes), `HttpOnly`, `SameSite=Lax`, host-only scope, and `Secure` in production. There is no browser Supabase client or local-storage session token. Cookie names separate applications; cookies themselves are not isolated by TCP port, so do not treat local ports as separate security boundaries.
- Login validates Google's `g_csrf_token` double-submit cookie in constant time, limits actual body bytes, rejects duplicate fields, and requires a short-lived app-specific nonce cookie. Only the nonce hash is sent to Google; its raw value is sent to Supabase for token verification. The nonce cookie is consumed on callback. No caller-provided redirect target is honored.
- Sign-out is POST-only and checks the exact configured request origin, the `Origin` header, and Fetch Metadata. It uses `scope: 'local'` and clears only this application's cookies. Denied users can sign out too. Revocation failures are reported; the UI does not falsely claim success. Supabase access tokens may remain valid until expiry even after refresh-token revocation; this is not a custom instant-revocation service.
- `requireMutationSuperadmin(request)` combines exact same-origin checks, JSON content type, unsafe-method enforcement, a custom `X-Prompt-Chains-CSRF: 1` header, and full authorization. **Every future mutation must call it before input processing/data access.** Do not add permissive CORS. The Google callback is the explicit cross-site exception and has its own CSRF and nonce checks. No business mutation endpoint exists yet.
- Secrets, raw provider errors, tokens, and profile records are not logged or returned to the client. `server-only` guards privileged modules. Basic anti-framing, MIME-sniffing, referrer, and Google-compatible opener headers are configured.

## Structure

```text
src/
  app/
    (protected)/          Authorized shell and four workspace routes
    login/ denied/        Public sign-in and denied views
    auth-error/           Public configuration/outage state
    auth/                 Prepare nonce, Google callback, local sign-out
    api/session/          Independently protected example read endpoint
  components/
    auth/                 Login, sign-out, shared auth card
    layout/ theme/ ui/    Workspace and presentation components
  lib/auth/               Server clients, authorization, request security
  config/                 Navigation definitions
  proxy.ts                Cookie refresh and default-deny request gate
 tests/                   Mock-only automated security tests
```

## Development database and Gemini setup

The application expects the additive Week 8 proposals to be applied to an isolated development project after the Week 7 preflight. The application calls only the guarded `pct_*` RPCs; it does not use direct table grants. Add at least one enabled model whose provider is inserted into `prompt_tool.gemini_providers` by an authorized operator before execution can succeed. Set `GEMINI_API_KEY` only in this application's server-side `.env.local`; the key is never sent to the browser. No production project is referenced by the repository.

Reference guidance: [Next.js authentication](https://nextjs.org/docs/app/guides/authentication), [Supabase server-side clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), and [Google sign-in verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Tooling notes

ESLint 9 is retained because plugins bundled by `eslint-config-next` declare compatibility through version 9. npm marks it deprecated; revisit when those plugins support ESLint 10. npm also reports an unapproved optional `unrs-resolver` postinstall script; required checks previously passed without approving it.

Existing IDE files were already staged before this work and remain untouched. No commits, pushes, remote repositories, deployments, or changes to the reference repositories are part of this work.

## Database proposal and isolated verification

The additive database plan is in [docs/database-architecture.md](docs/database-architecture.md), with [migration order and rollback guidance](docs/database-migrations.md) and a [verification matrix](docs/database-verification.md). SQL is deliberately stored under `supabase/proposals/week8/`, not an automatic migrations directory.

It preserves the Week 7 chain/model tables and mix RPC, and adds guarded CRUD/reorder RPCs, immutable run/step snapshots, execution leases, artifact associations, and chain-scoped history. Strict proposal types/validation are in `src/lib/database/`. The SQL was designed and manually applied only to the isolated development project; migrations are not run by the application. Tests parse SQL/PLpgSQL and validate offline contracts; real Auth, RLS, RPC, provider, and Gemini behavior still require isolated-project verification.

History deletion is intentionally separate in `supabase/proposals/week8/004_history_delete.sql`; the UI actions remain unavailable until that reviewed migration is applied to the isolated test project.
