# SaaS Starter

You want to ship your SaaS, not rebuild auth, billing, and admin panels from scratch. Clone this, run `bun run dev`, and start building your actual product.

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
<summary><strong>Convex cloud dev deployment (optional)</strong></summary>

The local embedded backend is preferred for day-to-day work. Each git worktree gets its own isolated Convex instance, so you can develop multiple features in parallel without conflicts. Use a cloud backend only when you need to test against cloud-specific behavior.

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
| `AUTH_E2E_TEST_SECRET`   | Secret for E2E test mutations             |   ·   |    ✓    |      |
| `AUTH_GOOGLE_ID`         | Google OAuth client ID                    |   ○   |    ○    |  ○   |
| `AUTH_GOOGLE_SECRET`     | Google OAuth client secret                |   ○   |    ○    |  ○   |
| `AUTH_GITHUB_ID`         | GitHub OAuth client ID                    |   ○   |    ○    |  ○   |
| `AUTH_GITHUB_SECRET`     | GitHub OAuth client secret                |   ○   |    ○    |  ○   |
| `RESEND_WEBHOOK_SECRET`  | Resend webhook signing secret             |   ○   |    ○    |  ○   |
| `SUPPORT_EMAIL`          | Support contact email                     |   ○   |    ○    |  ○   |
| `PREVIEW_ADMIN_PASSWORD` | Password for auto-seeded preview admin    |       |    ·    |      |

**Vercel** (project settings):

| Variable                 |                                  | Preview | Prod |
| ------------------------ | -------------------------------- | :-----: | :--: |
| `CONVEX_DEPLOY_KEY`      | Convex deploy key                |    ✓    |  ✓   |
| `TOLGEE_API_KEY`         | Tolgee API key for translations  |    ✓    |  ✓   |
| `PREVIEW_ADMIN_PASSWORD` | Preview admin password           |    ○    |      |
| `AUTUMN_SECRET_KEY`      | Autumn billing secret            |         |  ○   |
| `AUTUMN_PROD_SECRET_KEY` | Autumn production billing secret |         |  ○   |
| `PUBLIC_POSTHOG_API_KEY` | PostHog analytics API key        |         |  ○   |
| `PUBLIC_POSTHOG_HOST`    | PostHog analytics host           |         |  ○   |

</details>

<details>
<summary><strong>Features</strong></summary>

### Authentication

Email/password, Google and GitHub OAuth, and passkeys (WebAuthn) via [Better Auth](https://www.better-auth.com/) with a [local Convex install](https://labs.convex.dev/better-auth/features/local-install) for full feature access. Email verification required on signup, password reset flow, auto sign-in after verification. Role-based route protection (`user`/`admin`) checked via JWT in the SvelteKit hook, no round-trip to the backend.

### Billing

[Autumn](https://docs.useautumn.com/welcome) wraps Stripe so you configure pricing tiers and usage gates without writing webhook handlers. Define your products in `autumn.config.ts` or generate it at [app.useautumn.com/sandbox/quickstart](https://app.useautumn.com/sandbox/quickstart). Ships with Free (10 messages/month) and Pro ($10/month, unlimited) tiers. The community chat enforces the quota with low-balance warnings and an upgrade flow.

### Admin Panel

Full admin area at `/admin` with real-time metrics (total users, active sessions, recent signups), a users table with search/filter/sort and cursor-based pagination, per-user actions (ban, unban, impersonate, role change, session revocation), and a full audit log.

### AI Support Chat

An AI agent powered by [Convex Agent](https://www.convex.dev/components/agent) + [OpenRouter](https://openrouter.ai/) answers product questions, collects bug reports, and guides users through setup. A floating chatbar appears on every page. Users can attach images/PDFs and annotate screenshots with a built-in canvas editor before sending. When a question needs a human, admins take over from a 3-pane support dashboard with thread assignment, priority, internal notes, and status tracking. Users get an email when an admin replies.

### Email System

Transactional email via [Resend](https://www.convex.dev/components/resend) with automatic retries, idempotency, and delivery event tracking. Templates are built as Svelte components using a shadcn-style email component library (same `tv()` variants, same design tokens) and compiled to inline HTML at build time. The logo is auto-generated as an email-safe PNG from your SVG. Preview all templates in the browser at `/emails` during development, with optional "send test email" when a Resend key is configured.

### Internationalization

4 languages (EN, DE, ES, FR) with URL-based routing (`/de/pricing`, `/fr/about`) via [Tolgee](https://docs.tolgee.io/). In-context editing with Tolgee DevTools in development. The production build automatically tags and pulls the latest translations. A custom ESLint rule enforces that all `aria-label` attributes use translation keys instead of hardcoded strings.

> This project has too many translation keys for Tolgee Cloud's free tier. A self-hosted instance deploys in one click via [Coolify](https://coolify.io/docs/services/tolgee).

### Analytics

[PostHog](https://posthog.com/) with lazy loading and ad-blocker detection. When blocked, it falls back to a [Cloudflare Worker proxy](https://posthog.com/docs/advanced/proxy/cloudflare). Only identified users are tracked (`person_profiles: 'identified_only'`).

### AI Readiness

Marketing pages serve structured markdown when an AI agent sends `Accept: text/markdown`, with YAML frontmatter and `Vary: Accept` for correct CDN caching. A `/llms.txt` endpoint tells agents which pages are available and how to request them. Sitemap and robots.txt are generated dynamically across all 4 languages.

### SEO

`<SEOHead>` component on every page emitting OpenGraph, Twitter Cards, canonical URLs, and `hreflang` alternates for all languages plus `x-default`. OG image included at `static/og-image.png` (1200x630).

### Accessibility

Automated WCAG 2.1 AA testing via axe-core on all public pages in both light and dark mode. Skip-to-content link, semantic HTML, translated `aria-label` attributes, and `motion-safe:` prefixes enforced by a banned-pattern scanner.

### Real-Time

Everything updates live. Dashboard metrics, admin users table, community chat, support threads, AI agent responses (streamed token-by-token). Powered by Convex reactive queries. Rate limiting on support messages, file uploads, and LLM calls via `@convex-dev/rate-limiter`.

### User Settings

Change name, avatar (upload or URL), password (with strength indicator), email (with re-verification), manage passkeys, and view/revoke active sessions. File uploads use server-side MIME validation, access control, and hourly cleanup crons.

### Dark Mode

All components respond to the `.dark` class via `mode-watcher`. Mobile haptics via `web-haptics` (respects `prefers-reduced-motion`).

</details>

<details>
<summary><strong>Developer Experience</strong></summary>

### Worktrees

Each worktree gets its own isolated Convex backend, port, and auth secret via [convex-vite-plugin](https://github.com/juliusmarminge/convex-vite-plugin). Run `bun run worktree --open-editor` to create a new worktree with all local env vars copied over, or use the VS Code task. Develop multiple features in parallel without conflicts.

### Type-Safe Environment Variables

[varlock](https://github.com/nickreese/varlock) validates and generates types from `.env.schema` (SvelteKit/Vite) and `.env-convex.schema` (Convex backend). Two runtimes, two schemas, one validation pipeline.

### Pre-Commit Hooks

`varlock scan` checks for leaked secrets, then `static-checks:staged` runs spell checking, banned pattern detection (deprecated Tailwind tokens, bare `animate-spin`), Prettier, ESLint, and oxlint on staged files only.

### Dead Code Detection

[Knip](https://knip.dev/) configured for SvelteKit file-system routing and Convex backend entry points. Catches unused exports, dependencies, and files.

### Bundle Analysis

`ANALYZE=true bun run build` generates a treemap with gzip/brotli sizes so you can catch bloat before it ships.

### VS Code Integration

Dev server, static checks, i18n sync, email build, and worktree creation all available via `Run Task` (`Cmd/Ctrl+Shift+P`).

### Dependency Automation

Renovate groups non-major updates into a single PR and isolates breaking-change-prone packages (Better Auth, AI SDK, ESLint) into separate PRs for safer upgrades.

### Email Development

Email templates are Svelte components compiled to inline HTML on `postinstall` and during builds. Preview all templates in the browser at `/emails` with mock data, and optionally send test emails when a Resend key is configured.

</details>

## License

MIT
