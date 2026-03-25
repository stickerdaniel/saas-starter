# SaaS Starter

Agents write better code when they have good examples to work from. This starter ships with auth, billing, admin, AI chat, email, i18n, and more, all implemented end-to-end so your agents have real patterns to reference when building new features. It also includes the DX tools and guardrails to make sure what ships stays secure, performant, and maintainable. Clone it, run `bun run dev`, and start building.

## 1. Local Development

```bash
git clone https://github.com/stickerdaniel/saas-starter.git
cd saas-starter
bun install
bun run dev
```

A local Convex backend starts automatically with a seeded admin:

- `admin@local.dev` / `LocalDevAdmin123!`

Visit `http://localhost:5173` and sign in. No external services needed.

To activate all features locally, create `.env.convex.local` and add the keys you need. See the [environment variable matrix](#environment-variables) below for which keys to set and where.

<details>
<summary><strong>What about the Convex cloud dev deployment?</strong></summary>

I'd reccommend the local embedded backend for day-to-day work. Each git worktree gets its own isolated Convex instance, you can develop multiple features in parallel without conflicts.

```bash
bunx convex init                              # creates a Convex project
```

Add `CONVEX_DEPLOYMENT` to `.env.local` (printed by `convex init`), then:

```bash
bun run dev:cloud                             # frontend + cloud Convex backend
bunx convex env set KEY value                 # set backend env vars (see .env-convex.schema / env matrix below)
```

</details>

## 2. Preview Deployments (Vercel + Convex)

Each PR gets its own Vercel preview with an isolated Convex preview backend.

Create a Convex project at [dashboard.convex.dev](https://dashboard.convex.dev) and connect your repo to [Vercel](https://vercel.com).

Set the required Vercel and Convex preview variables listed in the [environment variable matrix](#environment-variables) below.

The deploy script (`scripts/vercel-deploy.ts`) tags and pulls translations, runs `bunx convex deploy` to create a preview backend named after the branch, auto-computes `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` from the deploy output, and sets `SITE_URL` on the Convex instance to match the Vercel preview URL. When `PREVIEW_ADMIN_PASSWORD` is set, it also seeds an admin user.

Push a branch and Vercel creates a preview deployment with its own Convex preview backend. Convex cleans up preview deployments after 5 days (14 days on Professional).

## 3. Production Deployment

Set the required Vercel and Convex production variables listed in the [environment variable matrix](#environment-variables) below.

### Deploy

```bash
vercel --prod
```

### First Admin

Sign up on the site, then either set the user's role to `admin` in the Convex dashboard or run (with the email you signed up with):

```bash
bunx convex run admin/mutations:seedFirstAdmin '{"email":"you@example.com"}' --prod
```

---

<details>
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

**Vercel** (project settings):

| Variable                 |                                 | Preview | Prod |
| ------------------------ | ------------------------------- | :-----: | :--: |
| `CONVEX_DEPLOY_KEY`      | Convex deploy key               |    ✓    |  ✓   |
| `TOLGEE_API_KEY`         | Tolgee API key for translations |    ✓    |  ✓   |
| `PREVIEW_ADMIN_PASSWORD` | Preview admin password          |    ○    |      |
| `PUBLIC_POSTHOG_API_KEY` | PostHog analytics API key       |         |  ○   |
| `PUBLIC_POSTHOG_HOST`    | PostHog analytics host          |         |  ○   |

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

[Knip](https://knip.dev/) is configured for SvelteKit file-system routing and Convex backend entry points. It catches unused exports, stale dependencies, and orphaned files so the codebase stays clean.

### Bundle Analysis

Run `ANALYZE=true bun run build` to generate a treemap with gzip and brotli sizes. Helps you spot bloat before it reaches production.

### VS Code Integration

Dev server, static checks, i18n sync, email build, and worktree creation are all available as VS Code tasks via `Run Task` (`Cmd/Ctrl+Shift+P`).

### Dependency Automation

Renovate groups non-major updates into a single PR and creates separate PRs for packages that tend to ship breaking changes (Better Auth, AI SDK, ESLint), so upgrades are easier to review.

### Email Development

Email templates are Svelte components compiled to inline HTML on `postinstall` and during builds. Preview every template in the browser at `/emails` with mock data, and optionally send a real test email when a Resend key is configured.

</details>

## License

MIT
