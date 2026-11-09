# Documentation

Guides for building a product on this template, from the first local run to production.

## Guides

- [Getting started](getting-started.md): create a project, run it locally, use a Convex cloud dev deployment, and rebrand it.
- [Choose an update model](update-models.md): CLI copy, shared-history clone, or fork, and how template changes and fixes travel between them.
- [Deployment](deployment/README.md): preview deployments per pull request, Cloudflare Workers, Vercel, production, self-hosting, and custom domains.
- [Features](features/README.md): what each feature does for your product and where its code starts.
- [Environment variables](reference/environment.md): every variable and where it needs to be set.
- [Development](development.md): regression guards, worktrees, checks, and the rest of the developer tooling.

## Reference material

This directory otherwise holds only knowledge the code cannot carry.

- [`decisions/`](./decisions/): dated decision records with the rationale and rejected alternatives behind a design.
- [`setup/`](./setup/): runbooks for configuring external services such as Cloudflare, PostHog, and Tolgee.
- [`recipes/`](./recipes/): optional extension paths for template adopters. Durable rationale stays in prose; copyable implementation should be tested or pinned to a stable interface.

Plans live in PR bodies and findings in issues. The root regression-guard decision determines whether a recurring mistake needs enforcement; the [Regression guards section of the root `AGENTS.md`](../AGENTS.md#regression-guards) maps an admitted guard to the earliest mechanism that can catch it. [`AGENTS.md`](./AGENTS.md) in this directory says what belongs in `docs/`.
