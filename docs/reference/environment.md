# Environment variables

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
| `AUTUMN_WEBHOOK_SECRET`  | Autumn webhook signing secret             |   ○   |    ○    |  ○   |
| `ADMIN_TIME_ZONE`        | Time zone of admin customer emails        |   ○   |    ○    |  ○   |
| `SUPPORT_EMAIL`          | Support contact email                     |   ○   |    ○    |  ○   |
| `PREVIEW_ADMIN_PASSWORD` | Password for auto-seeded preview admin    |       |    ✓    |      |

Set `PREVIEW_ADMIN_PASSWORD` once as a preview default (`bunx convex env default set --type preview PREVIEW_ADMIN_PASSWORD '<password>'`), new preview deployments inherit it automatically. The other preview values are set per deployment by `scripts/deploy.ts`.

**Hosting platform** (CF Workers build settings or Vercel project settings):

| Variable                       |                                                                                                                                          | Preview | Prod |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | :-----: | :--: |
| `CONVEX_DEPLOY_KEY`            | Convex production deploy key                                                                                                             |    ✓    |  ✓   |
| `CONVEX_PREVIEW_DEPLOY_KEY`    | Convex preview deploy key                                                                                                                |    ✓    |      |
| `CONVEX_MANAGEMENT_TOKEN`      | Convex team token for quota self-heal (mint at Team Settings > Access Tokens, Team ID shown on the same page)                            |    ○    |      |
| `CONVEX_PROJECT_ID`            | Numeric project id for quota self-heal (`curl -H "Authorization: Bearer $TOKEN" https://api.convex.dev/v1/teams/{teamId}/list_projects`) |    ○    |      |
| `PUBLIC_SITE_URL`              | Canonical frontend origin. Takes precedence over the platform URL in production; previews always use their own deployment URL            |    ·    |  ○   |
| `SITE_URL`                     | Cloudflare-compatible production frontend origin, mapped to `PUBLIC_SITE_URL`; separate from Convex `SITE_URL`                           |    ·    |  ○   |
| `WORKERS_NAME`                 | CF Workers only: worker name (matches `wrangler.toml`)                                                                                   |    ✓    |  ○   |
| `WORKERS_SUBDOMAIN`            | CF Workers only: account's `workers.dev` subdomain                                                                                       |    ✓    |  ○   |
| `CF_ZONE_ID`                   | CF Workers only: zone id of the custom domain, for post-deploy edge cache purge (skipped when unset)                                     |         |  ○   |
| `CF_PURGE_TOKEN`               | CF Workers only: API token with `Cache Purge`, for post-deploy edge cache purge (skipped when unset)                                     |         |  ○   |
| `NODE_ADAPTER`                 | Set to `1` to build with adapter-node for self-hosted production                                                                         |         |  ○   |
| `CONVEX_INTERNAL_URL`          | Internal Convex URL for Docker-network routing (self-hosted)                                                                             |         |  ○   |
| `TOLGEE_API_KEY`               | Tolgee CLI key for deploy-time sync (optional, skips when unset)                                                                         |    ○    |  ○   |
| `PUBLIC_POSTHOG_API_KEY`       | PostHog analytics API key                                                                                                                |         |  ○   |
| `PUBLIC_POSTHOG_HOST`          | PostHog ingestion host or managed reverse proxy                                                                                          |         |  ○   |
| `PUBLIC_POSTHOG_ALLOWED_HOSTS` | Comma-separated hostnames that may send analytics; every other host stays off                                                            |         |  ○   |
| `PRODUCTION_BRANCH`            | Cloudflare only: production branch name (default: `main`)                                                                                |    ○    |  ○   |

Builds that `scripts/deploy.ts` classifies as previews get empty PostHog key, host, and allowed-hosts values, even when the hosting platform shares build variables with production. Custom build commands are not covered, and existing previews keep their values until rebuilt.

`PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` are intentionally not in this table. The build (`scripts/deploy.ts`) derives both from `CONVEX_DEPLOY_KEY` and overwrites any value you set on the hosting platform, so setting them there has no effect. To point production at a different Convex deployment, change the deploy key, not the URL.

**GitHub Actions, preview cleanup** (repository Settings > Secrets and variables > Actions):

| Variable                  |                                                                                   | Required |
| ------------------------- | --------------------------------------------------------------------------------- | :------: |
| `CONVEX_MANAGEMENT_TOKEN` | Secret. The same team token as above, used to delete a preview when its PR closes |    ○     |
| `CONVEX_PROJECT_ID`       | Variable, not a secret. The same numeric project id                               |    ○     |

These are the same two names the hosting platform needs, set a second time for CI. Without them the `Delete Convex Preview` workflow logs that it is skipping and exits successfully, which also keeps fork PRs green.
