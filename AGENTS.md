# CLAUDE/AGENTS.md

> `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`, not the symlink.

This project is a saas template built with SvelteKit, Convex, Typescript and modern web technologies.

### SaaS Starter Template Bugs

<!-- DO NOT rename or remove this section when rebranding a fork. These links point to the upstream template repo. -->

If a project forked from this repo discovers a bug or weird behavior that originates from the template itself:

1. Search the [saas-starter issues](https://github.com/stickerdaniel/saas-starter/issues) for an existing report first.
2. If none exists, file a new issue describing the template bug/unexpected behavior.

### Cross-Platform Scripts

All npm scripts must work on macOS, Linux, and Windows. Avoid `sh -c` or bash-specific syntax. Use TypeScript scripts with `bun` for complex logic and `bun-tasks` for parallel execution. Bun's built-in cross-platform shell handles `VAR=$OTHER_VAR command` syntax in package.json scripts (see `_tolgee:*` scripts for the pattern).

## btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

Run `btca resources` to get the full list of all configured resources.

### Usage

```bash
btca ask -r <resource> -q "<question>"
```

Use multiple `-r` flags to query multiple resources at once:

```bash
btca ask -r svelte -r convex -q "How do I integrate Convex with SvelteKit?"
```

**Branch config:** When adding a new resource, verify the repo's default branch (`gh api repos/OWNER/REPO --jq '.default_branch'`). btca assumes `main` and fails silently on repos using `master`, `dev`, etc. Always set the `branch` field explicitly.

**New dependencies:** When adding a new dependency or devDependency, always add its repo to btca and verify with a simple test question (`btca ask -r <name> -q "<test>"`). If the query fails or returns irrelevant results, check that the `branch` field matches the repo's default branch and that the model config is correct. This keeps btca comprehensive across all project deps.

## Workflow

When starting work that needs its own branch/PR, always create a worktree first with `bun run worktree <type/short-description>` (e.g. `feature/dark-mode`, `fix/422-password-reset`, `chore/upgrade-svelte-5`, `hotfix/rate-limit-bypass`, `docs/api-reference`).

Worktrees live in a sibling directory next to the main repo at `<repo>.worktrees/<folder-name>/`. The folder name flattens branch slashes to dashes: `feat/dark-mode` creates `saas-starter.worktrees/feat-dark-mode/`. The git branch name keeps its original slashes; only the on-disk folder name is flattened. Edge case: branches like `feat/sentry` and `feat-sentry` map to the same folder — the script catches this as a loud error before touching git state.

NEVER use the `EnterWorktree` tool. Always use `bun run worktree` instead and add the worktree path before all consecutive actions. You must do this, the cwd is reset after each action and theres currently no better way to do this.

**Before committing:** Always check `git branch` first. If you're in a worktree, the branch already exists and was created by `bun run worktree` (which runs `git worktree add -b` and then `gt track` + `gt sync` when Graphite is installed). Use `git commit` to add commits, not `gt create`. Only use `gt create` when you need a new stacked branch on top of the current one.

### Commit Message Format

```
<type>(scope)[!]: <subject>
```

- Scope is required unless no meaningful scope can be defined
- Imperative mood, capitalize first letter, no period, max 50 chars
- `!` after scope = breaking change
- Body (optional): explain _what_ and _why_, wrap at 72 chars
- Link issues: `Resolves: #123` or `See also: #456`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

## Development Commands

### Core Development

- `bun run build` - Build for production
- `bun run dev` - Start Vite with an embedded local Convex backend (default)
- `bun run dev:cloud` - Start Vite + cloud Convex backend

NEVER use `bun run dev` to start the development server, its already running in a separate terminal.

Local dev notes (`bun run dev`):

- Always runs the local embedded backend (ignores `CONVEX_DEPLOYMENT` in `.env.local`).
- Seeds a verified local admin automatically after startup.
- Local seeded admin credentials: `admin@local.dev` / `LocalDevAdmin123!`
- Convex backend env vars are loaded from `.env.convex.local` (optional services like email, OAuth, billing, AI).
- `RESEND_API_KEY` and `AUTH_EMAIL` in `.env.convex.local` are only needed for real signup, verification, and password reset email flows.
- Local Convex state is isolated per branch/worktree under `.convex/`.
- `RESET_LOCAL_BACKEND=true bun run dev` clears the existing local Convex state before startup and restores the default seeded admin credentials.

### Logo Generation

- `bun run generate:logos` — Regenerate `static/logo-email.png` from `static/logo.svg`
- Runs automatically before `build:emails`. Always regenerates (no cache).
- When the user changes the logo: replace `static/logo.svg`, then run `bun run build:emails`

### Quality Checks & Testing

- `bun scripts/static-checks.ts src/lib/foo.ts src/routes/bar.svelte` - ALWAYS run after implementation with the changed files. This is the main app/project validation command.
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run Playwright E2E tests. Always run this after modifying E2E tests!
- `bun run test:unit` - Run Vitest unit tests

### Convex Backend

**IMPORTANT:** When any task involves Convex backend code — writing, reviewing, or modifying queries, mutations, actions, schema, HTTP endpoints, auth, file storage, or crons — you MUST read the `convex-guidelines` skill (`skills/convex-guidelines/SKILL.md`) first. It contains the canonical Convex coding patterns for this project.

- `bun run generate` - Regenerate Convex type definitions (`_generated/`). Auto-detects environment in priority order: cloud/self-hosted deployment (if configured) > local embedded backend (if `bun run dev` is running) > offline validation of existing types. Safe to run in any environment.
- `bun run check:convex` - Run the Convex TypeScript project check. Run this whenever you change `src/lib/convex/**` or shared code imported by Convex.

- `bun convex env set KEY value` - Set Convex environment variables (cloud)
- `bun convex env set KEY value --prod` - Set production environment variables (cloud)

**Running functions (cloud vs local):**

- **Cloud:** `bun convex run module:functionName '{"arg": "value"}'`
- **Local dev:** Use the HTTP API directly (the Convex MCP and CLI don't support local backends):
  ```bash
  # Admin key and port are printed in dev server startup logs
  # Backend URL is saved to .convex/.backend-url
  curl http://localhost:PORT/api/mutation \
    -H "Content-Type: application/json" \
    -H "Authorization: Convex ADMIN_KEY" \
    -d '{"path":"module:functionName","args":{},"format":"json"}'
  ```
  Replace `/api/mutation` with `/api/query` or `/api/action` as needed.

**Local Convex dashboard (requires Docker):**

```bash
docker run -e 'NEXT_PUBLIC_DEPLOYMENT_URL=http://127.0.0.1:PORT' -p '6791:6791' 'ghcr.io/get-convex/convex-dashboard:latest'
```

Open `http://localhost:6791` and enter the admin key from the dev server logs. Safari blocks localhost — use Chrome/Firefox. Local Convex dashboard is not required for local development, but it's useful for debugging and monitoring the Convex backend.

**E2E Test Security:** `src/lib/convex/tests.ts` contains public mutations (verify emails, promote to admin, delete users) gated by `AUTH_E2E_TEST_SECRET`. These are safe ONLY because the env var is NOT set in production. NEVER set `AUTH_E2E_TEST_SECRET` in the production Convex environment (`--prod`). If it's unset, all test endpoints are dead code.

### Intentional Anti-Pattern Comments

When using a pattern that would normally be flagged (e.g. unbounded `.collect()`, sequential deletes) but is acceptable in context, always add a short inline comment explaining why. This prevents future reviewers and agents from re-flagging it.

```typescript
// Bounded: adminNotificationPreferences table is small (admin users + custom emails, typically <100 rows)
const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

// Sequential deletes in test cleanup (test-only, small dataset)
for (const pref of allPreferences) { ... }
```

### Convex Components Storage

Convex components have isolated tables and storage namespaces. App code cannot use `ctx.storage.getUrl` to access a component's stored files. Use the component's APIs (e.g., download grants or HTTP routes) to fetch files/blobs instead.

### Convex Platform Guarantees

When reviewing Convex backend code, be aware of these platform guarantees.
See [official docs](https://docs.convex.dev/scheduling/scheduled-functions) for details.

**Scheduler Guarantees:**

- Scheduling from mutations is atomic - if `ctx.scheduler.runAfter()` is called within a mutation, it's part of the transaction. Either the whole mutation succeeds (including the schedule), or it all rolls back.
- Scheduled mutations are guaranteed exactly-once execution. Convex automatically retries internal errors, and only fails on developer errors.
- Actions are different - scheduling from actions is NOT atomic, and actions execute at-most-once (no automatic retry due to potential side effects).

**Components with Built-in Durability:**

- `@convex-dev/resend`: Idempotency keys guarantee exactly-once email delivery, durable execution via workpools (default: 5 retries, 30s initial backoff). Catching errors from `resend.sendEmail()` is valid - they indicate permanent failures (invalid config), not transient network issues. See [component docs](https://www.convex.dev/components/resend).
- `@convex-dev/workpool`: Configurable retry with backoff/jitter, `onComplete` callbacks, parallelism control.

- `@useautumn/convex`: SDK has built-in fail-open (returns `allowed: true` on 5xx/network errors). No manual fail-open logic needed in `autumn.check()` calls.

Note: Other components (`@convex-dev/better-auth`, `@convex-dev/rate-limiter`, `@convex-dev/agent`) do NOT have automatic retry for external API calls - standard error handling applies.

### Autumn Billing Config

After modifying `autumn.config.ts`, ALWAYS push changes to Autumn:

- `bunx atmn push` — Push config to sandbox
- `bunx atmn push -p` — Push config to production

Without pushing, the config change only exists locally and has no effect.

### Tolgee CLI

These commands use `varlock run` to load env vars from `.env.schema` + `.env.local`:

- `bun run i18n:pull` - Download latest translations from Tolgee Cloud. Run this ALWAYS before making any changes to the `src/i18n/*` json translation files.
- When adding new translation keys, ALWAYS add translations for ALL languages in the `src/i18n/*` json translation files.
- `bun run i18n:push` - Upload local translations. ALWAYS run this after making any changes to the `src/i18n/*` json translation files. Otherwise, your changes wont be pushed to the cloud! Run with `-- --tag-new-keys draft` to tag new keys as e.g. 'draft'

  Use tags to organize translation keys:
  - `draft` - New keys awaiting review
  - `feature-*` - Keys for specific features (e.g., `feature-auth`, `feature-checkout`)
  - `v*.*.*` - Keys added in specific versions (e.g., `v1.5.0`)

- `bun run i18n:cleanup` - Find every key that used to be in production but is now missing from the code; mark it as deprecated and stop calling it a production key.

  Tags automatically set by the `scripts/deploy.ts` script:

- `preview` - Automatically set for preview deployment keys
- `production` - Automatically set for production deployment keys
- `deprecated` - Keys no longer in code (safe to delete after review)

### Environment Variables

Two separate runtimes, two varlock schemas:

| File                 | Runtime                        | Types generated                  |
| -------------------- | ------------------------------ | -------------------------------- |
| `.env.schema`        | SvelteKit (Vercel / local)     | `src/env.d.ts`                   |
| `.env-convex.schema` | Convex backend (cloud / local) | `src/lib/convex/convex-env.d.ts` |

Runtime files:

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `.env.local`        | SvelteKit vars (Vite loads automatically)                      |
| `.env.convex.local` | Convex backend vars for local dev (loaded by `vite.config.ts`) |

- `varlock load` — validate env config and see resolved values
- `varlock run -- <cmd>` — run command with validated env + log redaction
- `varlock typegen --path .env-convex.schema` — regenerate `src/lib/convex/convex-env.d.ts`
- `varlock scan` — scan for leaked secrets in codebase
- `VITE_*` vars exposed to browser must be marked `@public` in schema

#### `$env/static/public` vs `$env/dynamic/public`

**Always use `$env/static/public` for `PUBLIC_*` vars.** This project builds per-environment (CF Workers Builds + Vercel), so all values are known at build time. Static gives build-time validation, dead-code elimination (optional integrations like PostHog are stripped when unconfigured), and avoids the `/_app/env.js` waterfall on prerendered pages. Only use `$env/dynamic/private` for server-only values genuinely set at runtime (e.g., `CONVEX_INTERNAL_URL`).

## Architecture Overview

### Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes syntax!), Tailwind CSS v4, Shadcn Svelte
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Better Auth Svelte Convex Component @convex-dev/better-auth-svelte. We use the local install to get full better auth feature access like passkeys, admin, etc. See <https://labs.convex.dev/better-auth/features/local-install> for authentication documentation.
- **Internationalization**: Tolgee (open source / cloud-hosted translation management with URL-based localization and in-context editing)
- **Testing**: Playwright (E2E), Vitest (unit)
- **Package Manager**: Bun. ALWAYS use bun instead of npm to run commands.

### Project Structure

- `src/lib/convex/` - Convex backend functions, schema, and auth config
- `src/lib/components/` - UI components
- `src/lib/i18n/` - Internationalization configuration
- `src/routes/[[lang]]/` - SvelteKit routes with language parameter
- `src/hooks.server.ts` - Server hooks for auth and language middleware

**Using translations in components:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<T keyName="welcome_message" />
<T keyName="greeting" params={{ name: 'John' }} />
```

**SEO meta tags:**

```svelte
<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
</script>

<SEOHead title="About Us" description="Learn more" />
```

- Every new `+page.svelte` route must include `SEOHead`.
- For localized routes under `src/routes/[[lang]]/`, `SEOHead` title and description must use translated `meta.*` keys in all 4 locale files (`en`, `de`, `es`, `fr`).
- `meta.*.title` values must be page-title only and must NOT include the site suffix or brand name. `SEOHead` appends `| SaaS Starter` automatically (use `"Settings"`, not `"Settings - SaaS Starter"`).
- Public marketing routes under `src/routes/[[lang]]/(marketing)/` can expose agent-facing markdown from the same URL via `Accept: text/markdown`. Keep the markdown source in a sibling `page.md.ts` file, not a `+page.*` file, and keep it in sync with the marketing page content. `/llms.txt` is the discovery entrypoint, and v1 markdown content is English-only.
- If a marketing/legal page obfuscates contact email in HTML, keep the agent-facing `page.md.ts` variant obfuscated too. Do not expose the raw email address only via `Accept: text/markdown`.

### Email System

Use the @convex-dev/resend email system for production-ready email delivery. Use btca with `convexResend` resource for component docs. For svelte email docs and templates, use btca with `betterSvelteEmail` resource.

#### Email System Architecture

```text
src/lib/convex/emails/
├── resend.ts              # Resend client configuration
├── events.ts              # Webhook event handlers
├── send.ts                # Email sending mutations
├── queries.ts             # Email status queries
└── mutations.ts           # Email management (cancel, status)
```

Emails are sent via internal mutations using the Resend component.

#### Email Event Tracking

Email events are automatically stored in the `emailEvents` table:

- `email.delivered` - Successfully delivered
- `email.bounced` - Hard or soft bounce
- `email.complained` - Marked as spam
- `email.opened` - Email opened (requires tracking enabled in Resend)
- `email.clicked` - Link clicked (requires tracking enabled in Resend)

Query email events using:

```typescript
const events = await ctx.runQuery(api.emails.queries.getEmailEvents, {
	emailId: 'email-id'
});
```

### PostHog Analytics

This project uses **PostHog** for product analytics with an optional **Cloudflare Worker proxy** to bypass ad blockers while minimizing costs.

## Testing Guidelines

### E2E Playwright Tests

- Located in `e2e/` directory
- Test users are automatically created with unique emails each run (via globalSetup) and deleted after tests (via globalTeardown)
- Requires `.env.test` with: AUTH_E2E_TEST_SECRET (must match Convex backend) and PUBLIC_CONVEX_URL
- `AuthenticatedLayout` sets `data-hydrated` on `<html>` in `onMount`; `waitForAuthenticated` in `e2e/utils/auth.ts` waits for it so clicks happen after Svelte hydration, not on inert SSR markup.
- See `.env.schema` for all available env vars with types and descriptions
- **CI E2E timing (CF Workers):** E2E tests only start after the CF Workers Build preview deployment completes (~2-3 min). The `e2e-preview-cf.yml` workflow triggers on the CF `check_run` event, extracts the preview URL, then runs Playwright against it. Results are posted as a commit status, not a check run. Total time from push to E2E result is ~7-8 min.

#### `data-testid` convention

- Prefer `data-testid` for all interactive controls and dynamic list/table content that E2E tests assert.
- Use stable, feature-scoped kebab-case IDs: `<feature>-<element>-<action>` (example: `admin-users-pagination-next`).
- Add test IDs on:
  - page root container
  - loading/empty states
  - filters/search/sort controls
  - pagination controls and page indicators
  - repeatable row/cell primitives needed for assertions (for example role/status badges and email cells)
- Avoid translated/user-generated strings in test IDs.
- Keep IDs deterministic and never include runtime values unless the test explicitly needs entity-specific targeting.

#### Convex table kit usage

- Use `createConvexCursorTable(...)` for table state orchestration (URL params, cursor stack, search/filter/sort/page-size resets, and next/previous prefetching).
- Use `ConvexCursorTableShell` for common chrome (search, toolbar slots, pagination controls, page indicator, rows-per-page).
- Required backend contract:
  - list query args: `cursor`, `numItems`, optional `search`, optional filters, optional `sortBy`
  - list query return: `{ items, continueCursor, isDone }`
  - count query args: same search/filter set (no cursor)
  - count query return: `number`
- Canonical URL keys for tables: `search`, `sort`, `page`, `page_size`, `cursor`, plus feature filter keys (for example `role`, `status`, `type`).
- Canonical sort serialization: `field.dir`.
- Default URL values must be omitted from links (`search=''`, `sort=''`, `page='1'`, `page_size` default, and default filter values).
- Shell testid convention:
  - search: `<prefix>-search`
  - page indicator: `<prefix>-page-indicator`
  - pagination: `<prefix>-pagination-prev` / `<prefix>-pagination-next` / `<prefix>-pagination-last` (first page button uses lg-only variant)
  - keep route-specific row/cell IDs for assertions (for example `recipient-row-*`, `admin-users-email-cell`).

### Vitest Unit Tests

## Development

<important_info>
Use Svelte 5's new syntax with TypeScript for reactivity, props, events, and content passing. Prioritize this over Svelte 4 syntax.
Key Changes:
Reactivity: $state for reactive state, $derived for computed values, $effect for side effects.
Props: Use $props() instead of export let.
Events: Use HTML attributes (e.g., onclick) instead of on:.
Content: Use {#snippet} and {@render} instead of slots.
Quick Examples:
State & Events: `<script lang="ts">let count = $state(0); </script> <button onclick={() => count += 1}>{count}</button>`
Derived: let doubled = $derived(count \* 2);
Props: <script lang="ts">let { name = 'World' } = $props(); </script> `<p>Hello, {name}!</p>`
Binding: `<script lang="ts">let { value = $bindable() } = $props(); </script> <input bind:value={value} />`
Snippets: `<div>{@render header()}</div> with <Child>{#snippet header()}<h1>Header</h1>{/snippet}</Child>`
Class Store: class Counter { count = $state(0); increment() { this.count += 1; } } export const counter = new Counter();
Notes:
Type $derived explicitly (e.g., let items: Item[] = $derived(...)) for arrays in TypeScript.
Default to new syntax for Svelte 5 benefits.
Avoid stores unless necessary for pub/sub.

Rune pitfalls:

- `$derived(() => { ... })` stores the **function**, not its return value. Use `$derived.by(() => { ... })` for multi-line computations. `$derived(expr)` is only for simple expressions.
- `$derived` has **no cleanup mechanism**. Never create `URL.createObjectURL()` or subscriptions inside `$derived`. Use `$effect` with a cleanup return instead.
- Never call `useQuery()` inside `$derived()`. Each call creates fresh `$state`/`$effect` internals without cleanup, causing ghost subscriptions. Use `useQuery(fn, () => condition ? args : 'skip')` for conditional queries.

Use the Svelte MCPs Get Documentation tool to get up-to-date Svelte documentation (only call this with a subagent!) and check code with the MCPs autofixer for wrong patterns. Query the svelte repo with btca for new features like remote functions.

Prop names must match the parent's passed prop name exactly.
</important_info>

### ESLint & Legacy Plugins

When adding ESLint plugins that export legacy `.eslintrc`-style configs (objects with `overrides`), use `fixupConfigRules()` from `@eslint/compat` to convert. See the Convex plugin block in `eslint.config.js` for the pattern.

### Real-time Features

- Use Convex's `useQuery` for reactive data — **never inside `$derived()`**, use the `'skip'` pattern instead
- Use Convex's `useMutation` for data modifications
- Use Convex's `useAction` for server-side actions

### Rendering & Data Strategy

#### Route rendering modes

Decision tree for new routes:

1. **Is the page public, static content (no per-user data in HTML)?**
   - Yes → `export const prerender = true` in route's `+layout.ts` or `+page.ts`
   - Add explicit `entries` in `svelte.config.js` for `[[lang]]` variants
   - Examples: marketing pages (home, about, terms, privacy, impressum)
   - Exception: if the page displays billing-dependent UI (`useCustomer()`), do NOT prerender — Autumn state doesn't recover on prerendered pages (`page.data.autumnState` is frozen at build time)
   - Exception: pricing page uses `useCustomer()` for plan badges/buttons → `export const prerender = false`

2. **Is the page behind authentication but has no real-time needs?**
   - Yes → Standard SSR (default). Server load fetches user data, client hydrates.
   - Examples: settings, email-verified

3. **Is the page behind authentication WITH real-time data?**
   - Yes → SSR + `useQuery` with `initialData` pattern (see below)
   - Examples: community-chat, ai-chat, admin dashboard, admin support

4. **Is the page an API endpoint or static file?**
   - Yes → `+server.ts` with custom Response
   - Examples: `/api/auth/[...all]`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`

#### Data-fetching patterns (decision tree)

For each data need in a new route, pick the right pattern:

1. **Auth-dependent data needed in SSR HTML?**
   → `+page.server.ts` with `createConvexHttpClient({ token: event.locals.token })`
   → Pass result to component as `data` prop
   → Wrap in try-catch for resilience

2. **Real-time data that should show instantly on load?**
   → Fetch in `+page.server.ts` AND subscribe client-side:

   ```ts
   // +page.server.ts
   const messages = await client.query(api.messages.list, {});
   return { messages };

   // +page.svelte
   const messagesQuery = useQuery(api.messages.list, {}, () => ({ initialData: data.messages }));
   const messages = $derived(messagesQuery.data ?? data.messages);
   ```

   This gives instant SSR content + live updates after hydration.

3. **Real-time data that can show a loading state?**
   → Skip server fetch, use `useQuery` directly (no `initialData`):

   ```ts
   const metrics = useQuery(api.admin.queries.getDashboardMetrics, {});
   ```

   Shows skeleton/loading state until data arrives. Use for admin panels, secondary data.

4. **Billing/subscription checks?**
   → `useCustomer()` from `@stickerdaniel/convex-autumn-svelte/sveltekit`
   → Access `customer.products`, `customer.features` for gates
   → Call `autumn.refetch()` after mutations that affect billing
   → Note: Autumn state comes from `page.data.autumnState` (set in root `+layout.server.ts`). Does NOT auto-recover on prerendered pages.

5. **Auth state checks?**
   → `useAuth()` from `@mmailaender/convex-better-auth-svelte/svelte`
   → Recovers independently via session cookies (safe on prerendered pages)
   → Only exposes `isLoading`, `isAuthenticated`, `fetchAccessToken` — NOT user profile data
   → For user profile data (email, name, id): use `authClient.useSession()` which returns `{ user: { email, name, id } }` and also recovers via cookies

6. **Write operations (mutations)?**
   → `useConvexClient()` + `client.mutation(api.path, args)`
   → For instant feedback: add `optimisticUpdate` callback
   → For billing-affecting mutations: call `autumn.refetch()` after

7. **Paginated data with filters?**
   → `usePaginatedQuery()` from `convex-svelte`
   → Combine with `useSearchParams()` from `runed/kit` for URL state
   → Use `keepPreviousData: true` to prevent UI flicker

#### Deferred loading pattern

For heavyweight non-critical JS (analytics, search, support widgets), use the `requestIdleCallback` + interaction listener pattern. Current deferred components: PostHog (3s), GlobalSearchShell (3.5s), LazyCustomerSupport (3s), RiveBackground (idle). See `AppPostHogBootstrap` for the canonical implementation.

#### Prerendering constraints

When prerendering pages, these data sources are frozen at build time:

- `page.data.autumnState` — billing data (no client recovery)
- `page.data.viewer` — user profile (no client recovery via `page.data`, but recoverable via `authClient.useSession()`)

These recover independently after hydration:

- Auth state — `AppAuthProvider` checks session cookies
- Convex `useQuery` subscriptions — auto-resubscribe
- `authClient.useSession()` — returns `{ user: { email, name, id } }` from cookies

Components that need user data on prerendered pages must use `authClient.useSession()` instead of `page.data.viewer`.

#### Cache-control for SSR pages

Marketing routes that are NOT prerendered get edge caching via `handleCacheControl` hook in `hooks.server.ts`:

- Condition: unauthenticated + matches `matchPublicMarketingRoute()`
- Headers: `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
- Placed AFTER `handleMarketingMarkdown` in `sequence()` to preserve markdown's own 5-minute TTL
- **Disabled on CF Workers preview deployments** — preview hostnames (`ALIAS-saas-starter.*.workers.dev`) skip `s-maxage` to prevent stale cached HTML from breaking `Accept: text/markdown` content negotiation.

#### Cache purging (production)

When a custom domain is added to CF Workers, add cache purging to the deploy flow (`scripts/cf-deploy.ts`) to prevent stale responses after production deploys:

- CF API: `POST /zones/{zone_id}/purge_cache` with `{ "purge_everything": true }`
- Docs: https://developers.cloudflare.com/api/resources/cache/methods/purge/
- Requires: Zone ID + API token with `Cache Purge` permission
- Not available for `.workers.dev` subdomains — only works with custom domains

### Cloudflare Platform Gotchas

- **CF Cache API ignores `Vary`.** Never rely on `Vary`-based content negotiation inside the worker. Bypass the worktop cache before it runs for any header-dependent response. See `scripts/patch-cf-worker.ts`.
- **Prerendered pages bypass SvelteKit hooks.** Patch the worker to fall through to `server.respond()` for any hook-dependent behavior on prerendered routes. See `scripts/patch-cf-worker.ts`.

### Regression Guard Decision Tree

When implementing a feature or fixing a bug, choose the right automated guard to prevent future regressions. Go through this decision tree **before marking work as done**.

#### "Two separate data sources must agree"

Examples: language lists in `svelte.config.js` vs `languages.ts`, env schema vs generated types.

→ **Unit test** asserting equality between the two sources. Use when the sources live in different files/formats that lint can't cross-reference.
Pattern: `scripts/prerender-sync.test.ts` asserts `svelte.config.js` languages match `languages.ts`.

#### "This file must be registered / have a required sibling"

Examples: marketing pages must be registered in `public-routes.ts`, marketing pages must have `page.md.ts` sibling.

→ **ESLint custom rule** that checks filesystem or reads a registry file. Use when the check is "the file I'm editing is missing something" — fires immediately in the editor and on save.
Pattern: `eslint/rules/require-marketing-route-registration.js`, `eslint/rules/require-marketing-markdown.js`.
How to add: create rule in `eslint/rules/`, register in `eslint.config.js`, add test in `eslint/rules/<name>.test.ts`.

#### "This pattern must never appear in code"

Examples: hardcoded aria-labels, barrel icon imports, deprecated Tailwind tokens, bare `animate-spin`.

→ **ESLint custom rule** (for AST-level patterns) or **banned pattern** in `scripts/static-checks.ts` (for simple string matching).
Pattern: `eslint/rules/no-hardcoded-aria-label.js`, banned patterns list in `static-checks.ts`.

#### "This build output must have specific properties"

Examples: worker patch must wrap all disjuncts, prerendered pages must exist in output.

→ **Unit test** on the build script/transform function.
Pattern: `scripts/patch-cf-worker.test.ts` tests the patch against a realistic worker fixture.

#### "User input must be validated"

Examples: chat message length, email format, required fields.

→ **Convex validator** (`v.*`) on the mutation/action args + client-side constraint (maxlength, pattern).
Always validate at both layers.

#### "This URL serves different content based on request headers"

Examples: marketing pages return markdown or HTML depending on `Accept`.

→ **Postbuild worker patch** (`scripts/patch-cf-worker.ts`) + **unit test** + E2E (`e2e/public-agent-surface.spec.ts`).
Bypass both worktop cache and static asset serving for negotiated requests.

#### "This route requires authentication/authorization"

Examples: `/app/*` requires login, `/admin/*` requires admin role.

→ **Server hook** in `hooks.server.ts` (fast JWT check, no DB query).
Pattern: `authFirstPattern` hook decodes JWT payload for role checks.
E2E test for the redirect behavior.

#### "This env var must be set / must not leak"

Examples: API keys, auth secrets, billing keys.

→ **Varlock schema** (`.env.schema` or `.env-convex.schema`) with `@sensitive` / `@optional` / `@public` directives.
Pre-commit hook runs `varlock scan --staged` to catch leaks.

#### "This user flow must keep working"

Examples: login, signup, checkout, admin user management.

→ **Playwright E2E test** in `e2e/`.
Runs automatically on Vercel and CF preview deployments.

#### "This utility function must handle edge cases"

Examples: URL parsing, stream processing, optimistic updates.

→ **Vitest unit test** co-located with the source file (`foo.test.ts` next to `foo.ts`).

#### "This security header / policy must be present"

Examples: CSP, HSTS, X-Frame-Options on all responses including static assets.

→ **`_headers` file** (project root) for static assets + **server hook** for SSR responses.
Both are needed — static assets bypass hooks.

#### Guard execution timeline

| When            | What runs                                                          | Catches                         |
| --------------- | ------------------------------------------------------------------ | ------------------------------- |
| **Pre-commit**  | varlock scan, static-checks (format, lint, types, banned patterns) | Secrets, style, types, patterns |
| **CI (on PR)**  | Same as pre-commit + unit tests                                    | Everything above + logic errors |
| **Post-deploy** | E2E tests on preview URL                                           | User flow regressions           |
| **Runtime**     | Hooks, validators, rate limits                                     | Auth, input, abuse              |

### Library Conventions and Key Patterns

#### Import Conventions

No barrel imports from icon libraries — use individual imports (`@lucide/svelte/icons/icon-name`).

#### UI Component Conventions

- Always use shadcn-svelte for ui components first. Use btca with `shadcnSvelte` resource.
- If a ui component doesn't exist in shadcn-svelte, check `@ieedan/shadcn-svelte-extras`. Use btca with `shadcnSvelteExtras` resource.
- For AI related components, check if ai-elements has what you need. Use btca with `aiElements` resource.
- Check cnblocks for well designed header, feature, pricing, footer and many more marketing blocks. Use btca with `cnblocks` resource. **When importing cnblocks components, verify they use project theme tokens** — cnblocks defines its own `--color-title`, `--color-primary-600` etc. that don't exist in this project's `@theme`. Replace with project tokens (`text-foreground`, `text-primary`). Also rename `className` prop to `class: className` to match project convention.
- Only create a new component if it doesn't exist in any of the above libraries.
- When implementing a new component, follow the existing shadcn-svelte component api and patterns in `src/lib/components/ui/`
- Use Tailwind CSS classes for layout and styling in general. Do not add additional styling classes to the shadcn svelte components. They look good by default.
- Prefer reusable Tailwind utilities (defined globally with `@utility` in `src/routes/layout.css`) over component-local `<style>` blocks for shared styling patterns (for example `no-drag`).
- Accessibility localization rule (all UI):
  - Never hardcode human-facing `aria-label` or `.sr-only` text in English.
  - Always localize screen-reader labels via Tolgee keys (not only tables, applies to all UI controls and navigation).
  - Accessible naming convention: prefer localized `.sr-only` text for icon-only buttons, use localized `aria-label` when hidden text is not practical, and avoid redundant double-labeling. Exception: keep `aria-label` in shadcn-svelte components as-is (their upstream pattern) to minimize theme maintenance diff.
  - Add `lang="en"` to content blocks that bypass Tolgee (e.g., legal pages rendered from raw English markdown).
  - Never add ARIA labels to non-functional buttons (no click handler). Hide decorative buttons from the a11y tree with `aria-hidden="true"` + `tabindex="-1"`, or remove them.
  - `<noscript>` content never needs `dark:` variants — dark mode requires JS (ModeWatcher). Noscript users always see light theme.

#### Keyboard Shortcuts

Never hardcode `⌘` or `Ctrl`. Use `cmdOrCtrl` / `optionOrAlt` from `$lib/hooks/is-mac.svelte` to show the correct modifier per platform.

#### Animations

For general animation craft (easing, duration, when to animate, performance, accessibility), follow the `emil-design-eng` skill (installed in `.agents/skills/`).

**Project-specific rules:**

- Simple animations should be implemented with plain CSS whenever possible.
- Before implementing any custom animation, check if sv-animate has a prebuilt component that can be used. Use btca with `svAnimate` resource.
- For custom animations, use Svelte's built-in animations, or motion-svelte (Framer Motion for Svelte). Use btca with `motionSvelte` resource.
- For Tailwind, use `motion-safe:` / `motion-reduce:` prefixes (e.g., `motion-safe:animate-fade-in`, `motion-reduce:animate-none`).
- For page transitions and state changes, use the View Transitions API with SvelteKit's `onNavigate`:

```svelte
<script lang="ts">
	import { onNavigate } from '$app/navigation';
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>
```

- Give elements unique `view-transition-name` to animate them independently. For UI elements (buttons, cards), override aspect ratio with `width: 100%; height: 100%` on the `::view-transition-old`/`::view-transition-new` pseudo-elements.
- Icon toggle pattern: 200ms `ease-in-out`, opacity + scale + `blur-sm` → `blur-0`.

#### Forms

Use this decision policy before implementing any form.

**Field UI conventions (all forms):**

- `import * as Field from '$lib/components/ui/field/index.js'`
- Wrap grouped controls in `Field.Group`.
- Do not add explicit spacing/layout utility classes to `Field.Group` (for example `gap-*`, `space-y-*`, `mt-*`, `mb-*`, `px-*`, `py-*`). Keep `Field.Group` spacing implicit.
- Each control should be a `Field.Field` with label + input + optional description/error.
- Keep `Field.Error` directly under its input inside the same `Field.Field` for field-level errors.
- Form-level errors (e.g. banners) may be outside `Field.Field`.
- Prefer one primary inline error message per field.

**Remote functions decision tree:**

1. Is this a Better Auth/session-sensitive flow (`signin`, `signup`, `forgot/reset`, `changeEmail`, `changePassword`)?
   - Yes -> Use existing client-side `authClient` pattern.
   - No -> Continue.
2. Is this realtime/high-frequency/optimistic interaction (chat composers, inline table edits, streaming workflows)?
   - Yes -> Use Convex client `useMutation` / `useAction` patterns.
   - No -> Continue.
3. Is this a one-shot server mutation with clear submit lifecycle and schema validation needs?
   - Yes -> Use SvelteKit remote `form(schema, handler)` with Valibot.
   - No -> Keep local/client form handling.
4. Does it include file upload?
   - If pre-upload/presigned-upload is already part of UX, keep upload client-side and only remote-submit final metadata if needed.

**Current repo guidance:**

- Good remote-form candidates: admin/settings-style one-shot forms (e.g. add-email dialog).
- Not recommended: auth pages, account email/password settings auth mutations, community chat submit, generic UI-only/dialog wrapper forms.

For remote-form implementation workflow only, read the `svelte-form-builder` skill (`skills/svelte-form-builder/SKILL.md`).

#### Lists with a lot of items

---

Use `svelte-infinite` with convex-svelte pagination for huge lists to automatically load more items as the user scrolls down the list. Use btca with `svelteInfinite` and `convexSvelte` resources. Before implementing this, research this codebase to see the pattern used in the existing code.

#### Runed (collection of utilities for Svelte 5)

Before creating our own utilities, research the runed library to see if the utility you need already exists. Use btca with `runed` resource.

- For URL/query state, prefer Runed `useSearchParams` over manual `$page.url` + `goto` wiring.
- Exception: in high-frequency selection UIs where query-param writes would cause unwanted Convex refetches (for example `src/routes/[[lang]]/admin/support/+page.svelte` thread selection), manual URL handling is acceptable.
  Here is a list of the utilities available:

<resource: Watches for changes and runs asynchronous data fetching, combining reactive state management with async operations.>
<watch: Runs a callback whenever specified reactive sources change. Includes variants like watch.pre (uses $effect.pre) and watchOnce / watchOnce.pre (run only once).>
<Context: A type-safe wrapper around Svelte's Context API for sharing data between components without prop drilling.>
<Debounced: A simple wrapper over useDebounce that returns a debounced state, allowing cancellation or immediate updates.>
<FiniteStateMachine: Defines a strongly-typed finite state machine for managing states and transitions based on events. Supports actions, lifecycle methods, wildcard handlers, and debouncing.>
<PersistedState: A reactive state manager that persists and synchronizes state across browser sessions and tabs using Web Storage APIs (localStorage or sessionStorage).>
<Previous: Tracks and provides reactive access to the previous value of a getter function.>
<StateHistory: Tracks changes to a getter's value, logging them and providing undo/redo functionality.>
<activeElement: Reactively tracks and provides access to the currently focused DOM element, searching through Shadow DOM boundaries.>
<ElementRect: Reactively tracks an element's dimensions (width, height) and position (top, left, right, bottom, x, y), updating automatically.>
<ElementSize: Reactively tracks only an element's dimensions (width, height), updating automatically.>
<IsFocusWithin: Tracks whether any descendant element has focus within a specified container element.>
<IsInViewport: Tracks if an element is visible within the current viewport, using useIntersectionObserver.>
<useIntersectionObserver: Watches for intersection changes of a target element relative to an ancestor element or the viewport. Allows pausing, resuming, and stopping the observer.>
<useMutationObserver: Observes changes (like attribute modifications) in a specified DOM element. Allows stopping the observer.>
<useResizeObserver: Detects and reports changes in the size (contentRect) of an element. Allows stopping the observer.>
<useEventListener: Attaches an event listener to a target (like document or an element reference) that is automatically disposed of when the component is destroyed or the target changes.>
<IsIdle: Tracks user activity (mouse, keyboard, touch) to determine if the user is idle based on a configurable timeout. Provides the last active time.>
<onClickOutside: Detects clicks outside a specified element and executes a callback. Useful for closing modals or dropdowns. Offers controls to start/stop the listener.>
<PressedKeys: Tracks which keyboard keys are currently being pressed. Allows checking for specific keys or getting all pressed keys.>
<useGeolocation: Provides reactive access to the browser's Geolocation API, including position coordinates, timestamp, error state, and support status. Allows pausing and resuming location tracking.>
<AnimationFrames: A wrapper for requestAnimationFrame that includes FPS limiting and provides frame metrics like delta time and current FPS.>
<useDebounce: Creates a debounced version of a callback function, delaying execution until after a specified period of inactivity. Allows forcing immediate execution or cancellation.>
<IsMounted: A simple class that returns the mounted state (true or false) of the Svelte component it's instantiated in.>

#### PaneForge

Components that make it easy to create resizable panes in your Svelte apps. Use btca with `paneforge` resource.

#### Threlte

Build interactive 3D apps for the web. Use btca with `threlte` resource. <https://threlte.xyz/>

#### Svelte Flow

A customizable Svelte component for building node-based editors and interactive diagrams by the creators of React Flow. Use btca with `xyflow` resource. <https://svelteflow.dev/>

### Vercel

- `vercel` - Deploy to Vercel
- `vercel --prod` - Deploy to production
- `vercel env ls` - List environment variables
- `printf "value" | vercel env add KEY environment` - Add environment variable (using printf avoids trailing newlines added when using heredoc)
- `vercel env rm KEY environment` - Remove environment variable
- `vercel logs` - View deployment logs
- `vercel domains` - Manage custom domains

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any, using the question tool.

## esbuild/Vite Error: The service was stopped

`bun i -f` should fix the issue.

## Lighthouse

### 1. Generate report

`npx lighthouse URL --only-categories=accessibility --output=json --chrome-flags="--headless=new" 2>/dev/null > /tmp/lh.json`

### 2. Query score + failing elements

`cat /tmp/lh.json | jq '{score: (.categories.accessibility.score*100|floor), failures: [.audits|to_entries[]|select(.value.score==0 and .value.scoreDisplayMode=="binary")|{id:.key,elements:[.value.details.items[]?|{selector:.node.selector,snippet:.node.snippet}]}]}'`

Swap accessibility for performance, seo, best-practices as needed.
