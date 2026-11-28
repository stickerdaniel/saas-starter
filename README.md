# saas-starter

[![Static Checks](https://github.com/stickerdaniel/saas-starter/actions/workflows/static-checks.yml/badge.svg)](https://github.com/stickerdaniel/saas-starter/actions/workflows/static-checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-%233fb950)](https://opensource.org/licenses/MIT)

<!-- template-only -->

[![Commit activity](https://img.shields.io/github/commit-activity/m/stickerdaniel/saas-starter?label=commits)](https://github.com/stickerdaniel/saas-starter/commits/main)

saas-starter is an open-source SvelteKit and Convex template for building your SaaS and running it after launch.

Most starters end where the real work starts: your first customer. This one also tells you who paid, who is stuck, and who was hit by a bug.

Runs in production at [Cadenza](https://cadenza.page), the hosted version of [LinkedIn MCP](https://github.com/stickerdaniel/linkedin-mcp-server) [![LinkedIn MCP stars](https://img.shields.io/github/stars/stickerdaniel/linkedin-mcp-server?style=flat&logo=github&label=stars&color=blue)](https://github.com/stickerdaniel/linkedin-mcp-server).

[Live demo](https://saas.daniel.sticker.name) | [Docs](https://saas.daniel.sticker.name/en/docs) | [Quick start](#quick-start)

The docs explain [why you can build on it](https://saas.daniel.sticker.name/en/docs#why-you-can-build-on-it), what the [feedback loop after launch](https://saas.daniel.sticker.name/en/docs#the-feedback-loop-after-launch) does, and how [template updates](https://saas.daniel.sticker.name/en/docs/update-models) reach your product.

<!-- /template-only -->

## Quick Start

Start the app with a local Convex backend and a seeded admin account.

<!-- template-only -->

Create a project with the CLI. It downloads a pinned template revision, runs `bun run setup` with your branding, and installs dependencies:

```bash
npm create saas-starter@latest my-app
cd my-app && bun run dev
```

The project includes the starter's test suite, and `--without-tests` leaves it out.

To create a GitHub template repository instead, run the commands below and then [rebrand it](docs/getting-started.md#rebrand-the-template):

<!-- /template-only -->

```bash
gh repo create my-saas-product --template stickerdaniel/saas-starter --clone
cd my-saas-product
bun install
bun run dev
```

Sign in with `admin@local.dev` / `LocalDevAdmin123!`. No external service or API key is needed until you turn a feature on. Optional features read their keys from `.env.convex.local`; see the [environment variables](docs/reference/environment.md). More options, including the Convex cloud dev deployment, are in [Getting started](docs/getting-started.md).

## Docs

The [docs](docs/README.md) cover setup, deployment, every feature, and the environment variables.

## License

MIT
