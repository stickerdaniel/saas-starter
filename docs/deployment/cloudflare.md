# Cloudflare Workers

Deploy via [Cloudflare Workers](https://developers.cloudflare.com/workers/) with Workers Builds:

## 1. Create Worker

- Rename `name` in `wrangler.toml` to your project name
- Run `bunx varlock-wrangler deploy` (first deploy creates the Worker)

`varlock-wrangler` is a thin wrapper around `wrangler` that resolves the env schema and uploads it to the Worker: non-sensitive values become Worker vars, `@sensitive` ones become Worker secrets, and a `__VARLOCK_ENV` secret carries the resolved graph that the SSR bundle reads at boot. The Cloudflare build embeds no env in the bundle, so resolved secrets never land in the Worker script (which is API-readable and archived per version). Deploying with plain `wrangler` would upload a Worker with no env at all. The other adapters (Vercel, adapter-node) have no upload step, so there the resolved env is still serialized into the bundle, with `@sensitive` values stripped out of it (`scripts/strip-varlock-secrets.ts`).

## 2. Connect repo

- CF dashboard > Workers & Pages > select Worker > Builds > Connect
- If the repo isn't visible: GitHub Settings > Applications > Cloudflare Workers and Pages > Configure > grant repo access

## 3. Configure build commands

| Field                                | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| Build command                        | `bunx varlock run -- bun scripts/deploy.ts` |
| Deploy command                       | `bun scripts/cf-prod-deploy.ts`             |
| Non-production branch deploy command | `bun scripts/cf-deploy.ts`                  |

## 4. Add build variables

Plain text, visible in logs.

| Variable            | Value                                  | Notes                                                                                                                                                                |
| ------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKERS_NAME`      | Name from `wrangler.toml`              | Required for preview URL construction                                                                                                                                |
| `WORKERS_SUBDOMAIN` | Account subdomain (e.g., `daniel-ce4`) | Visible at Workers & Pages overview as `*.workers.dev`                                                                                                               |
| `SITE_URL`          | `https://your-domain.com`              | Production frontend origin. The build maps it to `PUBLIC_SITE_URL`; previews always replace both values with their branch URL. Falls back to `workers.dev` if unset. |

## 5. Add build secrets

Encrypted, hidden from logs.

| Secret                      | Where to find it                                             |
| --------------------------- | ------------------------------------------------------------ |
| `CONVEX_DEPLOY_KEY`         | Convex dashboard > Project Settings > Production Deploy Keys |
| `CONVEX_PREVIEW_DEPLOY_KEY` | Convex dashboard > Project Settings > Preview Deploy Keys    |

## 6. Set Convex default env vars for previews

Each preview Convex deployment starts with no env vars. Set defaults in Convex dashboard > Project Settings > Default Environment Variables with only Preview/Development checked (not Production):

`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL`, `EMAIL_ASSET_URL`, `AUTUMN_SECRET_KEY`, `OPENROUTER_API_KEY`

Optionally add `AUTH_E2E_TEST_SECRET` for E2E tests on previews.

## 7. Enable branch builds

Enable non-production branch builds for preview deployments. Push a branch and Workers Builds creates a preview deployment with a stable per-branch URL.

## Edge cache purge

Once a custom domain is live, marketing pages are edge-cached (`s-maxage`), so a production deploy would otherwise serve stale HTML for up to an hour. The production deploy command `scripts/cf-prod-deploy.ts` purges the edge cache after each deploy when you set two values in CF Workers Builds: `CF_ZONE_ID` (build variable, the zone id from the domain's CF Overview page) and `CF_PURGE_TOKEN` (build secret, an API token with the `Zone > Cache Purge` permission). Without them the purge is skipped.

Set up the custom domain itself as described in [Custom domains](custom-domains.md).
