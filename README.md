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

Thanks to [convex-vite-plugin](https://github.com/juliusmarminge/convex-vite-plugin), each git worktree gets its own isolated Convex backend and the frontend is automatically wired to it, so you can develop multiple features in parallel without conflicts. Run `bun run worktree --open-editor` to create a new worktree with all local env vars copied over, or use the VS Code task (`Cmd/Ctrl+Shift+P` > `Run Task`).

### Enable Services Locally

Create `.env.convex.local` at the project root to activate optional integrations:

```bash
# Email delivery
RESEND_API_KEY=re_xxxxxxxxxxxx
AUTH_EMAIL=noreply@yourdomain.com
EMAIL_ASSET_URL=https://yourdomain.com

# OAuth providers
AUTH_GOOGLE_ID=your-client-id
AUTH_GOOGLE_SECRET=your-client-secret
AUTH_GITHUB_ID=your-client-id
AUTH_GITHUB_SECRET=your-client-secret

# AI support chat
OPENROUTER_API_KEY=sk-or-v1-xxxx

# Billing
AUTUMN_SECRET_KEY=am_sk_xxxx
```

Without these, the app runs fine. Email, OAuth, AI support, and billing are simply inactive.

## 2. Preview Deployments (Vercel + Convex)

Connect to a cloud Convex backend and deploy previews on every PR.

### Set up a Convex cloud project

```bash
bunx convex init                              # creates a Convex project
```

Add `CONVEX_DEPLOYMENT` to `.env.local` (printed by `convex init`). You can now develop against the cloud backend:

```bash
bun run dev:cloud                             # frontend + cloud Convex backend
bunx convex env set KEY value                 # set backend env vars (see .env-convex.schema)
```

### Connect Vercel

Set this in your Vercel project settings (scoped to **Preview**):

| Variable            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY` | Your dev deploy key from the [Convex dashboard](https://dashboard.convex.dev) |

The deploy script auto-computes `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` from the Convex deploy output. It also sets `SITE_URL` on each preview Convex instance to match the Vercel preview URL.

Push a branch and Vercel creates a preview deployment with its own Convex preview backend.

## 3. Production Deployment

### Set Vercel production env vars

Add the same variable scoped to **Production**, using your production deploy key:

| Variable            | Value                      |
| ------------------- | -------------------------- |
| `CONVEX_DEPLOY_KEY` | Your production deploy key |

Optional (if those features are used): `TOLGEE_API_KEY`, `AUTUMN_SECRET_KEY`, `AUTUMN_PROD_SECRET_KEY`, `PUBLIC_POSTHOG_API_KEY`, `PUBLIC_POSTHOG_HOST`.

### Set Convex production env vars

```bash
bunx convex env set BETTER_AUTH_SECRET "your-secret" --prod
bunx convex env set SITE_URL "https://yourdomain.com" --prod
bunx convex env set RESEND_API_KEY "re_xxx" --prod
bunx convex env set AUTH_EMAIL "noreply@yourdomain.com" --prod
bunx convex env set EMAIL_ASSET_URL "https://yourdomain.com" --prod
bunx convex env set AUTUMN_SECRET_KEY "am_sk_xxx" --prod
bunx convex env set OPENROUTER_API_KEY "sk-or-v1-xxx" --prod
# Optional: AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, RESEND_WEBHOOK_SECRET
```

### Deploy

```bash
vercel --prod
```

### First Admin

Sign up on the site, then either set the user's role to `admin` in the Convex dashboard or run:

```bash
bunx convex run admin/mutations:seedFirstAdmin '{"email":"you@example.com"}' --prod
```

---

<details>
<summary><strong>What You Get</strong></summary>

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

[PostHog](https://posthog.com/) with lazy loading and ad-blocker detection. When blocked, it falls back to a [Cloudflare Worker proxy](https://posthog.com/docs/deployment/cloudflare-worker). Only identified users are tracked (`person_profiles: 'identified_only'`).

### AI Readiness

Marketing pages serve structured markdown when an AI agent sends `Accept: text/markdown`, with YAML frontmatter and `Vary: Accept` for correct CDN caching. A `/llms.txt` endpoint tells agents which pages are available and how to request them. Sitemap and robots.txt are generated dynamically across all 4 languages.

### SEO

`<SEOHead>` component on every page emitting OpenGraph, Twitter Cards, canonical URLs, and `hreflang` alternates for all languages plus `x-default`. OG image included at `static/og-image.png` (1200x630).

### Accessibility

Automated WCAG 2.1 AA testing via axe-core on all public pages in both light and dark mode. Skip-to-content link, semantic HTML, translated `aria-label` attributes, and `motion-safe:` prefixes enforced by a banned-pattern scanner.

### Real-Time

Everything updates live. Dashboard metrics, admin users table, community chat, support threads, AI agent responses (streamed token-by-token). Powered by Convex reactive queries.

### More

- **Dark mode** via `mode-watcher`, all components respond to the `.dark` class
- **Rate limiting** on support messages, file uploads, and LLM calls via `@convex-dev/rate-limiter`
- **File uploads** with server-side MIME validation, access control, and hourly cleanup crons
- **Mobile haptics** via `web-haptics` (respects `prefers-reduced-motion`)
- **User settings**: change name, avatar (upload or URL), password (with strength indicator), email (with re-verification), manage passkeys, view/revoke active sessions

</details>

<details>
<summary><strong>Developer Experience</strong></summary>

- **Worktrees**: Each worktree gets its own isolated Convex backend, port, and auth secret. `bun run worktree --open-editor` creates one with env vars copied over.
- **Type-safe env vars**: [varlock](https://github.com/nickreese/varlock) validates and generates types from `.env.schema` and `.env-convex.schema`.
- **Pre-commit hooks**: `varlock scan` checks for leaked secrets, then `static-checks:staged` runs spell checking, banned pattern detection (deprecated Tailwind tokens, bare `animate-spin`), Prettier, ESLint, and oxlint.
- **Dead code detection**: [Knip](https://knip.dev/) configured for SvelteKit file-system routing and Convex backend entry points.
- **Bundle analysis**: `ANALYZE=true bun run build` generates a treemap with gzip/brotli sizes.
- **VS Code tasks**: Dev server, static checks, i18n sync, email build, and worktree creation all available via `Run Task`.
- **Dependency automation**: Renovate groups non-major updates, isolates breaking-change-prone packages (Better Auth, AI SDK, ESLint) into separate PRs.
- **Email development**: Edit Svelte email components, run `bun run build:emails` to compile to inline HTML. Preview all templates in the browser with mock data.

</details>

<details>
<summary><strong>Environment Variables</strong></summary>

Two runtimes, two schemas:

| Schema               | Runtime          | Local file                                                   |
| -------------------- | ---------------- | ------------------------------------------------------------ |
| `.env.schema`        | SvelteKit (Vite) | `.env.local`                                                 |
| `.env-convex.schema` | Convex backend   | `.env.convex.local` (local) or `bunx convex env set` (cloud) |

Both schemas are managed by [varlock](https://github.com/nickreese/varlock) for type-safe env access.

</details>

<details>
<summary><strong>Project Structure</strong></summary>

```
src/
  lib/
    convex/           Convex backend (schema, queries, mutations, actions)
    components/       App components
    components/ui/    shadcn-svelte primitives
    emails/           Email templates and shadcn-style email components
    i18n/             Translation files (en, de, es, fr)
    markdown/         AI agent markdown rendering
    marketing/        Public route definitions
  routes/
    api/auth/         Better Auth API handler
    llms.txt/         AI agent discovery
    sitemap.xml/      Dynamic sitemap
    robots.txt/       Crawler rules
    [[lang]]/
      (auth)/         Sign-in, forgot/reset password, email verification
      (marketing)/    Landing, pricing, about, legal pages
      app/            Protected area (dashboard, settings, community chat)
      admin/          Admin panel (dashboard, users, support, settings)
```

</details>

<details>
<summary><strong>Scripts</strong></summary>

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `bun run dev`          | Local dev (embedded Convex backend)      |
| `bun run dev:cloud`    | Cloud dev (requires `CONVEX_DEPLOYMENT`) |
| `bun run build`        | Production build                         |
| `bun run test`         | All tests (E2E + unit)                   |
| `bun run test:e2e`     | Playwright E2E tests                     |
| `bun run test:unit`    | Vitest unit tests                        |
| `bun run lint`         | ESLint + OxLint                          |
| `bun run check`        | svelte-check type checking               |
| `bun run build:emails` | Compile email templates                  |
| `bun run i18n:push`    | Push translations to Tolgee              |
| `bun run i18n:pull`    | Pull translations from Tolgee            |
| `bun run worktree`     | Create an isolated git worktree          |

</details>

## License

MIT
