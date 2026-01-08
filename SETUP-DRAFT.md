````markdown
#### Production Architecture

#### Automated Deployment (CI/CD)

The build process (via `scripts/vercel-deploy.sh`) automatically executes these steps:

**Production Build:**

1. `tolgee tag --filter-extracted --tag production --untag preview` - Updates 'production' tag to match current code
2. `tolgee pull` - Downloads fresh translations
3. `convex deploy` & `bun run build` - Deploys backend and bundles app with new translations

**Preview Build:**

1. `tolgee tag --filter-extracted --tag preview` - Tags keys used in this preview
2. `tolgee pull` - Downloads fresh translations
3. `convex deploy` & `bun run build` - Deploys backend and bundles app

**Development Mode:**

- Translations loaded via `staticData` (from `src/i18n/` files)
- DevTools enabled for in-context editing (requires `VITE_TOLGEE_API_KEY`)
- Hot-reload translations with `bun run i18n:pull`

**Production Mode:**

- Translations bundled at build-time via `staticData`
- DevTools automatically removed (tree-shaken)
- No API keys in production bundle (secure)
- No runtime API calls (faster performance)
- CI/CD automatically pulls latest translations before build

**Why staticData over runtime API loading?**

- ✅ Security: No API keys exposed to clients
- ✅ Performance: Translations bundled with app (no API calls)
- ✅ Reliability: No dependency on Tolgee servers at runtime
- ✅ Official Tolgee best practice for production

#### Quick Setup

1. Create a Tolgee account at https://app.tolgee.io
2. Add `VITE_TOLGEE_API_KEY` to `.env.local`
3. Add translations in Tolgee Cloud or use in-context editor

#### Usage

**Tagging Strategy:**

**Recommended Workflow:**

1. **Development:** Add translations using in-context editor or `<T>` component
2. **Before Release:**

   ```bash
   # Tag current keys as production (add version tag if needed)
   bunx dotenv -e .env.local -- bunx tolgee tag --filter-extracted --tag production --tag v1.5.0

   # Pull latest translations for build
   bun run i18n:pull
   ```
````

1. **After Release:**

```bash
 # Find and tag deprecated keys
 bun run i18n:cleanup
```

2. **Cleanup:** Review deprecated keys in Tolgee Cloud, then delete

**CLI Tag Filtering Options:**

- `--filter-tag <tag>` - Include only keys with tag (supports `*` wildcard)
- `--filter-not-tag <tag>` - Exclude keys with tag
- `--filter-extracted` - Include keys found in code
- `--filter-not-extracted` - Include keys NOT found in code
- `--tag <tag>` - Add tag to filtered keys
- `--untag <tag>` - Remove tag from filtered keys (supports `*` wildcard)

````



**Configuration:**

Tolgee CLI is configured via `.tolgeerc` in the project root. The project uses a **Project API Key** (starts with `tgpak_`), which automatically includes the project ID - no manual configuration needed.

The CLI uses the `TOLGEE_API_KEY` environment variable for authentication in CI/CD (see `.env.local.example`). Locally, the key is stored in `.tolgeerc` (which is gitignored).


**CI/CD Integration:**

Tolgee CLI is integrated into the CI/CD pipeline to automatically:

1. Tag all translation keys found in code as "production"
2. Pull latest translations from Tolgee Cloud before build

**Implementation locations:**

- **GitHub Actions**: See [.github/workflows/quality-checks.yml](.github/workflows/quality-checks.yml) for CI configuration
- **Vercel**: See [vercel.json](vercel.json) for the build command configuration
- **Environment variables**: Add `TOLGEE_API_KEY` to GitHub Secrets and Vercel Environment Variables

**Finding deprecated keys:**

After deployments, identify unused translation keys:

```bash
# Find keys tagged "production" but not in current code
bun run i18n:cleanup
````

Review deprecated keys in Tolgee Cloud, then delete them manually to avoid accidental data loss.

For complete documentation, see `docs/i18n-setup.md`.

```

```

```markdown
#### RESEND Webhook Setup

Configure webhook in Resend dashboard to point to:
```

[https://your-deployment.convex.site/resend-webhook](https://your-deployment.convex.site/resend-webhook)

````

The webhook endpoint is configured in `src/lib/convex/http.ts`.#
### PostHog Analytics & Proxy





This project uses **PostHog** for product analytics with an optional **Cloudflare Worker proxy** to bypass ad blockers while minimizing costs.

#### Implementation

**Client-Side** (`src/routes/+layout.ts`):

```typescript
// Try direct PostHog access first
try {
 await fetch(PUBLIC_POSTHOG_HOST, { method: 'HEAD', mode: 'no-cors' });
 apiHost = PUBLIC_POSTHOG_HOST; // Direct access works (free)
} catch (error) {
 apiHost = PUBLIC_POSTHOG_PROXY_HOST; // Fallback to proxy (~5-10% of users)
}

posthog.init(PUBLIC_POSTHOG_API_KEY, {
 api_host: apiHost,
 ui_host: 'https://eu.posthog.com'
});
````

**Cloudflare Worker** (`docs/posthog-proxy-worker.js`):

- Proxies requests to `eu.i.posthog.com`
- Caches static assets for performance
- Preserves client IP for accurate geolocation
- Removes cookies for privacy

#### Setup Instructions

**For complete setup guide, see `[docs/posthog-proxy-setup.md](docs/posthog-proxy-setup.md)**`

**Quick Steps:**

1. Create Cloudflare Worker with code from `docs/posthog-proxy-worker.js`
2. Add custom domain (avoid obvious names like "tracking" or "analytics")
3. Set `PUBLIC_POSTHOG_PROXY_HOST` in `.env.local` and Vercel
4. Deploy and test with/without ad blocker

#### Environment Variables

**Local Development** (`.env.local`):

```env
PUBLIC_POSTHOG_API_KEY=phc_your_api_key_here
PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
PUBLIC_POSTHOG_PROXY_HOST=https://metrics.yourdomain.com  # Optional
```

**Production** (Vercel Dashboard):

- `PUBLIC_POSTHOG_API_KEY` - PostHog project API key
- `PUBLIC_POSTHOG_HOST` - PostHog region URL (`https://eu.i.posthog.com` or `https://us.i.posthog.com`)
- `PUBLIC_POSTHOG_PROXY_HOST` - Your Cloudflare Worker custom domain (optional)

#### Cost Expectations

**Without Proxy:**

- Data loss: ~5-10% of users (ad blocker users)
- Cloudflare cost: $0/month

**With Always-On Proxy:**

- Data loss: 0%
- Cloudflare cost: May exceed free tier (100k requests/day)

**With Smart Fallback (This Implementation):**

- Data loss: 0%
- Cloudflare cost: $0/month (well within free tier)
- Worker invocations: ~5-10k/month (only ad blocker users)

## Environment Configuration

This project uses multiple environment variable configurations organized by purpose and platform. Each `.example` file corresponds to where variables should be set.

### Configuration Files Overview

| File                                               | Purpose                     | Platform                     | When Used                     |
| -------------------------------------------------- | --------------------------- | ---------------------------- | ----------------------------- |
| [.env.local.example](.env.local.example)           | Local development           | Your machine                 | Running `bun run dev`         |
| [.env.ci.example](.env.ci.example)                 | CI testing & quality checks | GitHub Actions Secrets       | Every push/PR                 |
| [.env.deployment.example](.env.deployment.example) | Automatic deployments       | Vercel Environment Variables | Preview/PR/Production deploys |
| [.env.convex.example](.env.convex.example)         | Backend configuration       | Convex Dashboard             | Backend runtime               |
| [.env.test.example](.env.test.example)             | E2E testing                 | Local + GitHub Actions       | Running tests                 |

### Quick Setup Guide

**1. Local Development** (`.env.local`)

```bash
# Copy example and fill in values
cp .env.local.example .env.local
# Required: CONVEX_DEPLOYMENT, PUBLIC_CONVEX_URL, VITE_TOLGEE_API_KEY, TOLGEE_API_KEY
```

**2. GitHub Actions** (Repository Secrets)

```bash
# Add to: Repository Settings → Secrets → Actions
# Required: TEST_CONVEX_URL, AUTH_E2E_TEST_SECRET, TOLGEE_API_KEY
# See .env.ci.example for details
```

**3. Vercel** (Environment Variables)

```bash
# Add to: Vercel Dashboard → Project Settings → Environment Variables
# Required: PUBLIC_CONVEX_URL, CONVEX_DEPLOY_KEY, TOLGEE_API_KEY
# See .env.deployment.example for details
```

**4. Convex Backend** (via CLI)

```bash
# Required: RESEND_API_KEY, AUTH_EMAIL
# Optional: AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, RESEND_WEBHOOK_SECRET
# For testing: AUTH_E2E_TEST_SECRET
bunx convex env set KEY value
# See .env.convex.example for complete list
```

### Environment Variable Summary

**Convex Backend** (set via `bunx convex env set`):

- `BETTER_AUTH_SECRET` - Session signing secret (required)
- `RESEND_API_KEY` - Email sending (required)
- `AUTH_EMAIL` - Sender email address (required)
- `RESEND_WEBHOOK_SECRET` - Webhook verification (optional)
- `AUTH_GOOGLE_ID` - Google OAuth client ID (optional)
- `AUTH_GOOGLE_SECRET` - Google OAuth secret (optional)
- `AUTH_E2E_TEST_SECRET` - E2E test authentication (required for CI/CD)

**Vercel Deployments** (Vercel Dashboard):

- `PUBLIC_CONVEX_URL` - Production Convex URL (runtime)
- `CONVEX_DEPLOY_KEY` - Deploy Convex functions (build-time)
- `TOLGEE_API_KEY` - Pull translations (build-time)

**GitHub Actions** (Repository Secrets):

- `TEST_CONVEX_URL` - Test Convex deployment
- `AUTH_E2E_TEST_SECRET` - E2E test auth
- `TOLGEE_API_KEY` - Tag production keys

**Local Development** (`.env.local`):

- `CONVEX_DEPLOYMENT` - Dev deployment name
- `PUBLIC_CONVEX_URL` - Dev Convex URL
- `VITE_TOLGEE_API_KEY` - DevTools in-context editing
- `TOLGEE_API_KEY` - CLI for pulling translations

**E2E Testing** (`.env.test`):

- `AUTH_E2E_TEST_SECRET` - Test authentication
- `PUBLIC_E2E_TEST` - Enable test mode

```markdown
- Initial test data setup: `bunx convex run tests:init`### Vercel Deployment

1. Set `PUBLIC_CONVEX_URL` environment variable
2. Set `CONVEX_DEPLOY_KEY` for automatic Convex function deployment
3. Deploy with `vercel --prod`
```

```markdown
### Email System

This project uses the **@convex-dev/resend** component for production-ready email delivery.

#### Features

- **Automatic Queuing & Batching** - Efficiently handles bulk email sending
- **Durable Execution** - Guarantees delivery even if servers restart
- **Built-in Idempotency** - Prevents duplicate email sends
- **Rate Limit Compliance** - Automatic handling of API rate limits
- **Event Tracking** - Webhooks for delivery, bounces, complaints, opens, clicks
- **Test Mode** - Safe development with delivery restrictions
```

```markdown
## Deployment

### Vercel Deployment

1. Set `PUBLIC_CONVEX_URL` environment variable
2. Set `CONVEX_DEPLOY_KEY` for automatic Convex function deployment
3. Deploy with `vercel --prod`

### GitHub Actions

- Automated quality checks on push/PR
- Uses development Convex environment for tests
- Requires secrets: `TEST_CONVEX_URL`, `AUTH_E2E_TEST_SECRET`
```
