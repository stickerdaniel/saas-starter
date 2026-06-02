# SaaS Starter

[![Static Checks](https://github.com/stickerdaniel/saas-starter/actions/workflows/static-checks.yml/badge.svg)](https://github.com/stickerdaniel/saas-starter/actions/workflows/static-checks.yml)
[![E2E Tests (CF)](https://github.com/stickerdaniel/saas-starter/actions/workflows/e2e-preview-cf.yml/badge.svg)](https://github.com/stickerdaniel/saas-starter/actions/workflows/e2e-preview-cf.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-%233fb950)](https://opensource.org/licenses/MIT)

A free, open-source SaaS template built with SvelteKit, Convex, Better Auth, Tolgee, and Tailwind. Auth, billing, admin, AI chat, email, and i18n are all implemented end-to-end so you and your AI agents have real patterns to build on. Deploy on Cloudflare Workers or Vercel for $0.

> See a live demo of the user-facing side at **[saas.daniel.sticker.name](https://saas.daniel.sticker.name)**. Admin features like the admin panel, support dashboard, and user management are not accessible there. To explore everything, follow the steps below.

## Why This Exists

I kept rebuilding the same stack and pointing my agent at old repos for patterns I'd already nailed, so I baked the good ones in: a streaming AI chat with tool calling and file uploads, and a support chat that triages with AI then hands off to a human admin. I also wired in guardrails so an agent can check its own work, because it will happily tell you it's done when it isn't. Static checks and E2E on every preview catch that. Open source, free to run.

## Quick Start

Four commands to a running app with a local Convex backend and seeded admin:

```bash
gh repo create my-saas-product --template stickerdaniel/saas-starter --clone
cd my-saas-product
bun install
bun run dev
```

Visit the URL printed by `bun run dev` (a stable per-project port) and sign in:

```text
admin@local.dev
```

```text
LocalDevAdmin123!
```

No external services required. To activate optional features (email, OAuth, billing, AI), add keys to `.env.convex.local`. See the [environment variable matrix](#environment-variables) below.

<details>
<summary><strong>What about the Convex cloud dev deployment?</strong></summary>

I'd recommend the local embedded backend for day-to-day work. Each git worktree gets its own isolated Convex instance, you can develop multiple features in parallel without conflicts.

```bash
bunx convex init                              # creates a Convex project
```

`convex init` prints a `CONVEX_DEPLOYMENT` value — add it to `.env.local`. `bun run dev` still uses the local embedded backend; the variable is only needed for `dev:cloud` and the Convex CLI.

```bash
bun run dev:cloud                             # frontend + cloud Convex backend
bunx convex env set KEY value                 # set backend env vars (see .env-convex.schema / env matrix below)
```

</details>

<details>
<summary><strong>Optional: stable named URLs with portless</strong></summary>

`bun run dev` and `bun run test:e2e` already pick stable per-project ports (derived from the project path in `scripts/dev-ports.ts`), so several projects or worktrees run at once without clashing. If you'd rather use names than remember ports, [vercel-labs/portless](https://github.com/vercel-labs/portless) fronts the dev server with a `.localhost` URL and gives each git worktree its own branch subdomain.

Run portless with `--no-tls` so everything stays on HTTP. The Convex backend reaches the browser over a WebSocket on its own local port; an HTTPS frontend would block that as mixed content, plain HTTP does not.

Point the harness at the named URL with `PORTLESS_SITE_URL`. The dev/test wrappers then hand port control to portless, and the same URL flows into the Convex `SITE_URL`/trusted origin and Playwright's base URL:

```bash
PORTLESS_SITE_URL=http://myapp.localhost bun run dev
PORTLESS_SITE_URL=http://myapp.localhost bun run test:e2e
```

This stays optional: a plain clone needs nothing extra and never has to install portless or grant it the privileged ports it binds.

</details>

### Rebrand the template

Once the app runs, rebrand it:

```bash
bun run setup
```

The setup script replaces the project name, GitHub links, and prompts for brand, company, operator, address, and contact email — all written to `src/lib/config/legal.ts`. After running it:

1. Replace `static/logo.svg` with your logo, then run `bun run build:emails`
2. Refresh email snapshots: `bun run test:unit -- email-snapshots.test.ts -u`
3. Update editorial brand mentions in `src/i18n/{en,de,es,fr}.json` (FAQ, hero copy, pricing tier names)
4. Update legal copy in `src/lib/content/privacy.ts` and `src/lib/content/terms.ts` if needed

## Preview Deployments

Each PR gets its own preview deployment with an isolated Convex preview backend. Supports both Cloudflare Workers and Vercel.

Create a Convex project at [dashboard.convex.dev](https://dashboard.convex.dev) and connect your repo to your hosting platform.

The deploy script (`scripts/deploy.ts`) auto-detects the platform from environment variables (`WORKERS_CI`, `CF_PAGES`, or `VERCEL`), tags and pulls translations, runs `bunx convex deploy` to create a preview backend named after the branch, auto-computes `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` from the deploy output, and sets `SITE_URL` on the Convex instance to match the preview URL. When `PREVIEW_ADMIN_PASSWORD` is set, it also seeds an admin user.

<details>
<summary><strong>Cloudflare Workers setup</strong></summary>

Deploy via [Cloudflare Workers](https://developers.cloudflare.com/workers/) with Workers Builds:

**1. Create Worker**

- Rename `name` in `wrangler.toml` to your project name
- Run `bunx wrangler deploy` (first deploy creates the Worker)

**2. Connect repo**

- CF dashboard > Workers & Pages > select Worker > Builds > Connect
- If the repo isn't visible: GitHub Settings > Applications > Cloudflare Workers and Pages > Configure > grant repo access

**3. Configure build commands**

| Field                                | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| Build command                        | `bunx varlock run -- bun scripts/deploy.ts` |
| Deploy command                       | `bunx wrangler deploy`                      |
| Non-production branch deploy command | `bun scripts/cf-deploy.ts`                  |

**4. Add build variables** (plain text, visible in logs)

| Variable            | Value                                  | Notes                                                                                                                                                       |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKERS_NAME`      | Name from `wrangler.toml`              | Required for preview URL construction                                                                                                                       |
| `WORKERS_SUBDOMAIN` | Account subdomain (e.g., `daniel-ce4`) | Visible at Workers & Pages overview as `*.workers.dev`                                                                                                      |
| `SITE_URL`          | `https://your-domain.com`              | Production custom domain. Ignored for previews (URL is auto-constructed from `WORKERS_NAME`/`WORKERS_SUBDOMAIN`). Falls back to `workers.dev` URL if unset. |

**5. Add build secrets** (encrypted, hidden from logs)

| Secret                      | Where to find it                                             |
| --------------------------- | ------------------------------------------------------------ |
| `CONVEX_DEPLOY_KEY`         | Convex dashboard > Project Settings > Production Deploy Keys |
| `CONVEX_PREVIEW_DEPLOY_KEY` | Convex dashboard > Project Settings > Preview Deploy Keys    |

**6. Set Convex default env vars for previews**

Each preview Convex deployment starts with no env vars. Set defaults in Convex dashboard > Project Settings > Default Environment Variables with only Preview/Development checked (not Production):

`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL`, `EMAIL_ASSET_URL`, `AUTUMN_SECRET_KEY`, `OPENROUTER_API_KEY`

Optionally add `AUTH_E2E_TEST_SECRET` for E2E tests on previews.

**7. Enable branch builds**

Enable non-production branch builds for preview deployments. Push a branch and Workers Builds creates a preview deployment with a stable per-branch URL.

</details>

<details>
<summary><strong>Vercel setup</strong></summary>

Connect your repo to [Vercel](https://vercel.com). Set the required Vercel and Convex preview variables listed in the [environment variable matrix](#environment-variables) below.

- Vercel: Project Settings > Environment Variables
- Convex: Project settings > Default Environment Variables > Add with ✓ Production

Push a branch and Vercel creates a preview deployment with its own Convex preview backend.

</details>

Convex cleans up preview deployments after 5 days (14 days on Professional). If you hit `DeploymentQuotaReached` anyway (team quota is 40, counted across all projects), the deploy script can self-heal by pruning the oldest eligible preview — opt in by setting `CONVEX_MANAGEMENT_TOKEN` and `CONVEX_PROJECT_ID` (see the [env matrix](#environment-variables)).

## Production Deployment

Set the required platform and Convex production variables listed in the [environment variable matrix](#environment-variables) below.

- Platform: Project Settings > Environment Variables (CF Workers or Vercel)
- Convex: Select your Prod deployment > Settings > Environment Variables > Add

### Deploy

Push to your production branch (default: `main`) and the connected platform deploys automatically, or trigger a manual deploy:

**Cloudflare Workers:**

```bash
bunx wrangler deploy
```

**Vercel:**

```bash
vercel --prod
```

<details>
<summary><strong>Self-hosted production with Coolify</strong></summary>

Use the existing Cloudflare Workers or Vercel setup for preview deployments, and run production on Coolify when you want a self-hosted Node app with the same Convex cloud backend.

**Architecture:**

- **Previews:** Cloudflare Workers or Vercel, using the existing preview deploy flow above
- **Production app hosting:** Coolify
- **Backend/data/auth:** Convex cloud production deployment

**Coolify setup:**

1. Add the repo as an application in Coolify and use the Nixpacks build pack
2. Set the build command to:

```bash
bunx varlock run -- bun scripts/deploy.ts
```

3. Set the start command to:

```bash
node build
```

4. Set app-level environment variables in Coolify:
   - `NODE_ADAPTER=1`
   - `CONVEX_DEPLOY_KEY`
   - `TOLGEE_API_KEY` (optional)
   - `CONVEX_INTERNAL_URL` (optional, only if the app container can reach Convex through a private Docker network URL)
5. Set the required Convex production environment variables in the Convex dashboard
6. Set `SITE_URL` on the Convex production deployment to your public production domain

The build command intentionally reuses `scripts/deploy.ts` so production stays aligned with the existing deploy flow: Tolgee sync remains optional, Convex is deployed during the build, and `PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL` are computed automatically from the deploy output instead of being copied into Coolify by hand.

</details>

### First Admin

Sign up on the site, then either set the user's role to `admin` in the Convex dashboard or run (with the email you signed up with):

```bash
bunx convex run admin/mutations:seedFirstAdmin '{"email":"you@example.com"}' --prod
```

<details>
<summary><strong>Resend webhook (optional)</strong></summary>

For email event tracking (delivery, bounce, open, click):

1. Resend dashboard > Webhooks > Add Endpoint
2. URL: `https://<your-deployment>.convex.site/resend-webhook`
3. Select events: `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`
4. Copy the signing secret and set it on Convex: `bunx convex env set RESEND_WEBHOOK_SECRET <secret> --prod`

</details>

<details>
<summary><strong>Custom domain (Cloudflare Workers)</strong></summary>

If your domain's DNS is on Cloudflare: CF dashboard > Workers & Pages > select Worker > Settings > Domains & Routes > Add > Custom Domain. CF creates DNS records and provisions SSL automatically. Set `SITE_URL` on your Convex production deployment to match.

If your domain uses external DNS, use the CF for SaaS method below.

</details>

<details>
<summary><strong>Custom domain without Cloudflare DNS (CF for SaaS)</strong></summary>

CF Workers custom domains require the domain's DNS zone to be on Cloudflare. If your domain uses external DNS (e.g., registrar-managed DNS, Route 53), use [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) (Custom Hostnames) on a CF-managed zone you control.

**Prerequisites:**

- A Cloudflare-managed zone (e.g., `proxy-zone.com` with DNS on CF)
- Your external domain (e.g., `app.yourdomain.com` on non-CF DNS)

**Steps:**

1. In your CF zone's DNS, add an originless record for the fallback origin:
   - Type: `AAAA`, Name: `saas-fallback`, Value: `100::`, Proxy: enabled

2. In **SSL/TLS > Custom Hostnames**, set the fallback origin to `saas-fallback.proxy-zone.com`

3. Add a wildcard Workers Route on the zone: `*/*` pointing to your Worker

4. Add `app.yourdomain.com` as a Custom Hostname (certificate auto-provisions via HTTP validation)

5. On your external DNS, add a CNAME: `app.yourdomain.com` pointing to `saas-fallback.proxy-zone.com`

6. For automatic cert renewal, add a DCV delegation CNAME on your external DNS:
   `_acme-challenge.app.yourdomain.com` pointing to `<token>.dcv.cloudflare.com` (shown in the Custom Hostnames dashboard)

7. Set `SITE_URL` on your Convex production deployment to `https://app.yourdomain.com`

The originless `100::` record tells Cloudflare there is no real origin server. The wildcard Workers Route catches all traffic entering the zone (including Custom Hostname traffic) and routes it to your Worker.

</details>

---

<details id="environment-variables">
<summary><strong>Environment Variables</strong></summary>

Two runtimes, two schemas, both managed by [varlock](https://github.com/nickreese/varlock) for type-safe access. `.env.schema` covers SvelteKit (Vite), `.env-convex.schema` covers the Convex backend. The matrix below shows every variable and where it needs to be set.

`✓` required | `○` optional | `·` auto-set by tooling

**Convex backend** (`.env.convex.local` for local, [dashboard](https://dashboard.convex.dev) for cloud):

| Variable                 |                                           | Local | Preview | Prod |
| ------------------------ | ----------------------------------------- | :---: | :-----: | :--: |
| `BETTER_AUTH_SECRET`     | Session/token signing secret              |   ·   |    ✓    |  ✓   |
| `SITE_URL`               | Base URL for OAuth redirects              |   ·   |    ·    |  ✓   |
| `RESEND_API_KEY`         | Resend API key for transactional email    |   ○   |    ✓    |  ✓   |
| `AUTH_EMAIL`             | Sender address for auth emails            |   ○   |    ✓    |  ✓   |
| `EMAIL_ASSET_URL`        | Public URL for email images (always prod) |   ○   |    ✓    |  ✓   |
| `AUTUMN_SECRET_KEY`      | Autumn billing secret key                 |   ○   |    ✓    |  ✓   |
| `OPENROUTER_API_KEY`     | OpenRouter API key for AI support chat    |   ○   |    ✓    |  ✓   |
| `AUTH_E2E_TEST_SECRET`   | Secret for E2E test mutations             |   ○   |    ○    |      |
| `AUTH_GOOGLE_ID`         | Google OAuth client ID                    |   ○   |    ○    |  ○   |
| `AUTH_GOOGLE_SECRET`     | Google OAuth client secret                |   ○   |    ○    |  ○   |
| `AUTH_GITHUB_ID`         | GitHub OAuth client ID                    |   ○   |    ○    |  ○   |
| `AUTH_GITHUB_SECRET`     | GitHub OAuth client secret                |   ○   |    ○    |  ○   |
| `RESEND_WEBHOOK_SECRET`  | Resend webhook signing secret             |   ○   |    ○    |  ○   |
| `SUPPORT_EMAIL`          | Support contact email                     |   ○   |    ○    |  ○   |
| `PREVIEW_ADMIN_PASSWORD` | Password for auto-seeded preview admin    |       |    ·    |      |

**Hosting platform** (CF Workers build settings or Vercel project settings):

| Variable                    |                                                                                                                                          | Preview | Prod |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :--: |
| `CONVEX_DEPLOY_KEY`         | Convex production deploy key                                                                                                             |    ✓    |  ✓   |
| `CONVEX_PREVIEW_DEPLOY_KEY` | Convex preview deploy key                                                                                                                |    ✓    |      |
| `CONVEX_MANAGEMENT_TOKEN`   | Convex Team Token for quota self-heal (mint at Team Settings > Access Tokens, Team ID shown on the same page)                            |    ○    |      |
| `CONVEX_PROJECT_ID`         | Numeric project id for quota self-heal (`curl -H "Authorization: Bearer $TOKEN" https://api.convex.dev/v1/teams/{teamId}/list_projects`) |    ○    |      |
| `WORKERS_NAME`              | CF Workers only: worker name (matches `wrangler.toml`)                                                                                   |    ✓    |  ○   |
| `WORKERS_SUBDOMAIN`         | CF Workers only: account's `workers.dev` subdomain                                                                                       |    ✓    |  ○   |
| `NODE_ADAPTER`              | Set to `1` to build with adapter-node for self-hosted production                                                                         |         |  ○   |
| `CONVEX_INTERNAL_URL`       | Internal Convex URL for Docker-network routing (self-hosted)                                                                             |         |  ○   |
| `TOLGEE_API_KEY`            | Tolgee CLI key for deploy-time sync (optional, skips when unset)                                                                         |    ○    |  ○   |
| `PREVIEW_ADMIN_PASSWORD`    | Preview admin password                                                                                                                   |    ○    |      |
| `PUBLIC_POSTHOG_API_KEY`    | PostHog analytics API key                                                                                                                |         |  ○   |
| `PUBLIC_POSTHOG_HOST`       | PostHog analytics host                                                                                                                   |         |  ○   |
| `PRODUCTION_BRANCH`         | Cloudflare only: production branch name (default: `main`)                                                                                |    ○    |  ○   |

`PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` are intentionally not in this table. The build (`scripts/deploy.ts`) derives both from `CONVEX_DEPLOY_KEY` and overwrites any value you set on the hosting platform, so setting them there has no effect. To point production at a different Convex deployment, change the deploy key, not the URL.

</details>

<details>
<summary><strong>Features</strong></summary>

### Authentication

Sign in with email/password, Google, GitHub, or passkeys. Powered by [Better Auth](https://www.better-auth.com/) running as a [local Convex install](https://labs.convex.dev/better-auth/features/local-install) so every auth feature works without an external service. New signups verify their email before getting access, password resets work out of the box, and users are signed in automatically after verification. Routes are protected by role (`user` or `admin`) via a JWT check in the SvelteKit hook, with no extra round-trip to the backend.

### Billing

[Autumn](https://docs.useautumn.com/welcome) sits on top of Stripe and lets you define pricing tiers and usage gates without writing webhook handlers. Configure your products in `autumn.config.ts` or generate a starter config at [app.useautumn.com/sandbox/quickstart](https://app.useautumn.com/sandbox/quickstart). Ships with a Free tier (10 messages/month) and a Pro tier ($10/month, unlimited). The community chat enforces quotas, warns users when they are running low, and offers an upgrade flow.

### Admin Panel

A full admin area at `/admin` with live metrics (total users, active sessions, recent signups), a searchable users table with filtering, sorting, and cursor-based pagination, per-user actions (ban, unban, impersonate, change role, revoke sessions), and a complete audit log.

### AI Support Chat

An AI agent built on [Convex Agent](https://www.convex.dev/components/agent) and [OpenRouter](https://openrouter.ai/) answers product questions, collects bug reports, and walks users through setup. A floating chatbar is available on every page. Users can attach images or PDFs and annotate screenshots with a built-in canvas editor before sending. When a question needs a human, admins take over from a 3-pane support dashboard with thread assignment, priority levels, internal notes, and status tracking. Users receive an email when an admin replies.

### Email System

Transactional email delivered through [Resend](https://www.convex.dev/components/resend) with automatic retries, idempotency, and delivery tracking. Templates are written as Svelte components using a shadcn-style email component library (same `tv()` variants, same design tokens) and compiled to inline HTML at build time. Your logo is converted to an email-safe PNG automatically. During development, preview every template in the browser at `/emails` and optionally send a real test email when a Resend key is configured.

### Internationalization

4 languages (EN, DE, ES, FR) with URL-based routing (`/de/pricing`, `/fr/about`) powered by [Tolgee](https://docs.tolgee.io/). Edit translations in context with Tolgee DevTools during development. Production builds tag and pull the latest translations automatically. A custom ESLint rule ensures every `aria-label` uses a translation key instead of a hardcoded string.

> This project has too many translation keys for Tolgee Cloud's free tier. A self-hosted instance deploys in one click via [Coolify](https://coolify.io/docs/services/tolgee).

### Analytics

[PostHog](https://posthog.com/) loads lazily and detects ad blockers. When blocked, tracking falls back to a [Cloudflare Worker proxy](https://posthog.com/docs/advanced/proxy/cloudflare). Only identified users are tracked (`person_profiles: 'identified_only'`).

### AI Readiness

Marketing pages return structured markdown when an AI agent sends `Accept: text/markdown`, complete with YAML frontmatter and `Vary: Accept` headers for correct CDN caching. A `/llms.txt` endpoint lists available pages and explains how to request them. Sitemap and robots.txt are generated dynamically across all 4 languages.

### SEO

Every page includes a `<SEOHead>` component that outputs OpenGraph tags, Twitter Cards, canonical URLs, and `hreflang` alternates for all languages plus `x-default`. An OG image is included at `static/og-image.png` (1200x630).

### Accessibility

All public pages are tested against WCAG 2.1 AA using axe-core in both light and dark mode. The template includes a skip-to-content link, semantic HTML throughout, translated `aria-label` attributes, and a banned-pattern scanner that enforces `motion-safe:` prefixes on animations.

### Real-Time

Everything updates live: dashboard metrics, the admin users table, community chat, support threads, and AI agent responses streamed token-by-token. Built on Convex reactive queries. Messages, file uploads, and LLM calls are rate-limited via `@convex-dev/rate-limiter`.

### User Settings

Users can update their profile, change their password with live strength feedback, swap their email (triggers re-verification), manage passkeys, and review or revoke active sessions. Uploaded avatars and attachments are validated on the server and cleaned up automatically.

### Dark Mode

Every component supports light and dark mode via `mode-watcher`. Interactive elements provide subtle haptic feedback on mobile via `web-haptics` (respects `prefers-reduced-motion`).

</details>

<details>
<summary><strong>Developer Experience</strong></summary>

### Worktrees

Each worktree gets its own isolated Convex backend, port, and auth secret via [convex-vite-plugin](https://github.com/juliusmarminge/convex-vite-plugin). Run `bun run worktree feature/dark-mode --open-editor` to create one with all local env vars copied over, or use the VS Code task. Work on multiple features in parallel without stepping on each other.

### Type-Safe Environment Variables

[varlock](https://github.com/nickreese/varlock) validates env vars against two schemas and generates TypeScript types from them. `.env.schema` covers SvelteKit (Vite), `.env-convex.schema` covers the Convex backend. If a required variable is missing or mistyped, you find out before the app starts.

### Pre-Commit Hooks

Every commit is checked automatically. `varlock scan` looks for leaked secrets, then `static-checks:staged` runs spell checking, banned pattern detection (catches deprecated Tailwind tokens, bare `animate-spin`, and similar issues), Prettier, ESLint, and oxlint on staged files only.

### Dead Code Detection

[Knip](https://knip.dev/) is configured for SvelteKit file-system routing and Convex backend entry points. It catches unused exports, stale dependencies, and orphaned files so the codebase stays clean. [oxlint](https://oxc.rs/docs/guide/usage/linter) adds a custom Convex rule that flags unused Convex functions at lint time.

### Bundle Analysis

Run `ANALYZE=true bun run build` to generate a treemap with gzip and brotli sizes. Helps you spot bloat before it reaches production.

### VS Code Integration

Dev server, static checks, i18n sync, email build, and worktree creation are all available as VS Code tasks via `Run Task` (`Cmd/Ctrl+Shift+P`).

### Dependency Automation

Renovate groups non-major updates into a single PR and creates separate PRs for packages that tend to ship breaking changes (Better Auth, AI SDK, ESLint), so upgrades are easier to review.

### Email Development

Email templates are Svelte components compiled to inline HTML on `postinstall` and during builds. Preview every template in the browser at `/emails` with mock data, and optionally send a real test email when a Resend key is configured.

</details>

---

## License

MIT
