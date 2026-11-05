# Preview deployments

Each PR gets its own preview deployment with an isolated Convex preview backend. Supports both Cloudflare Workers and Vercel. Pull requests from forks get a Cloudflare preview only after a maintainer approves the `fork-preview` environment in the [fork preview workflow](../../.github/workflows/e2e-fork-preview.yml).

Create a Convex project at [dashboard.convex.dev](https://dashboard.convex.dev) and connect your repo to your hosting platform: [Cloudflare Workers](cloudflare.md) or [Vercel](vercel.md).

Protect the production branch, require the `Lint & Format` and `English PR Metadata` checks, and leave **Require branches to be up to date before merging** disabled so independent PRs can finish their checks in parallel. `English PR Metadata` checks the pull request title and each prose paragraph in the body. `Lint & Format` runs the Convex consumer-compatibility guard against the candidate it checks. Before merging, fetch the target and inspect intervening changes; update for conflicts or actual integration dependencies. Checks on an older candidate do not certify the combined tree after the target advances. Hosting builds start from a push, so the push-time check can report a problem after a build has already started.

The guard forces the compatibility release for a renamed function. Alias retirement still needs operational evidence: browser bundles can remain open indefinitely, and a scheduled target must remain until every pending `runAfter` or `runAt` job carrying its old path has run or been cancelled.

The deploy script (`scripts/deploy.ts`) auto-detects the platform from environment variables (`WORKERS_CI`, `CF_PAGES`, or `VERCEL`), tags and pulls translations, runs `bunx convex deploy` to create a preview backend named after the branch, auto-computes `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` from the deploy output, and sets `SITE_URL` on the Convex instance to match the preview URL. It also seeds an admin user (`admin@preview.dev`) on every preview. Set the password once as a Convex preview default env var, every new preview deployment inherits it regardless of which CI builds it:

```sh
bunx convex env default set --type preview PREVIEW_ADMIN_PASSWORD '<password>'
```

## Preview cleanup

Convex expires preview deployments after 5 days (14 on Professional), and the team quota is 40 counted across all projects. An active repo reaches that ceiling well before the TTL frees anything, and once it does, creating a preview fails with `DeploymentQuotaReached`.

Two optional mechanisms keep the count down:

- **On PR close** (`.github/workflows/delete-convex-preview.yml`) deletes the branch's preview as soon as its PR is merged or closed, so a short-lived PR stops holding a slot for days. It resolves the deployment by the branch's canonical identifier, treats an already-deleted preview as success, and fails closed without deleting anything if two identifiers normalize to the same slug.
- **On quota exhaustion** (`scripts/deploy/steps.ts`) prunes the oldest eligible preview and retries once when a build hits `DeploymentQuotaReached`. It never prunes the current branch, the newest preview, or a branch that still exists on the remote.

Both read `CONVEX_MANAGEMENT_TOKEN` and `CONVEX_PROJECT_ID`, and they run in different environments, so the values have to be set in two places: GitHub Actions for the workflow, and the hosting platform's build settings for the deploy script (see the [env matrix](../reference/environment.md)). Configuring one leaves the other silently inactive, which is easy to miss because the deploy script only reports its half when a build is already failing.

The token is team-scoped. Mint it on the team that owns this project: a token from another team you belong to is valid and authenticates fine, yet every call for this project returns `404` rather than an authorization error.
