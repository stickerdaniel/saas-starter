# Getting started

Create a project, run it locally, and rebrand it. Decide first how the project should receive later starter changes: [Choose an update model](update-models.md).

## Quick Start

Start the app with a local Convex backend and a seeded admin account.

Create a project with the CLI. It downloads a pinned template revision, runs `bun run setup` with your branding, and installs dependencies:

```bash
npm create saas-starter@latest my-app
```

Alternatively, use `bun create saas-starter@latest my-app` or `npx create-saas-starter@latest my-app`. See the [CLI README](https://github.com/stickerdaniel/saas-starter/blob/main/packages/create-saas-starter/README.md) for options and requirements. When it finishes, run `bun run dev` inside `my-app`.

To create a GitHub template repository instead, run the commands below and then [rebrand it](#rebrand-the-template):

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

No external services required. To activate optional features (email, OAuth, billing, AI), add keys to `.env.convex.local`. See the [environment variable matrix](reference/environment.md).

### What about the Convex cloud dev deployment?

I'd recommend the local embedded backend for day-to-day work. Each git worktree gets its own isolated Convex instance, you can develop multiple features in parallel without conflicts.

```bash
bunx convex dev --configure                   # creates/links a Convex project
```

`convex dev` prints a `CONVEX_DEPLOYMENT` value, add it to `.env.local`. `bun run dev` still uses the local embedded backend; the variable is only needed for `dev:cloud` and the Convex CLI.

```bash
bun run dev:cloud                             # frontend + cloud Convex backend
bunx convex env set KEY value                 # set backend env vars (see .env-convex.schema / docs/reference/environment.md)
```

### Optional: stable named URLs with portless

`bun run dev` and `bun run test:e2e` already pick stable per-project ports (derived from the project path in `scripts/dev-ports.ts`), so several projects or worktrees run at once without clashing. If you'd rather use names than remember ports, [vercel-labs/portless](https://github.com/vercel-labs/portless) fronts the dev server with a `.localhost` URL and gives each git worktree its own branch subdomain.

Run portless with `--no-tls` so everything stays on HTTP. The Convex backend reaches the browser over a WebSocket on its own local port; an HTTPS frontend would block that as mixed content, plain HTTP does not.

Point the harness at the named URL with `PORTLESS_SITE_URL`. The dev/test wrappers then hand port control to portless, and the same URL flows into the Convex `SITE_URL`/trusted origin and Playwright's base URL:

```bash
PORTLESS_SITE_URL=http://myapp.localhost bun run dev
PORTLESS_SITE_URL=http://myapp.localhost bun run test:e2e
```

This stays optional: a plain clone needs nothing extra and never has to install portless or grant it the privileged ports it binds.

## Rebrand the template

Projects created with the CLI have already run this step. Otherwise, rebrand the app once it runs:

```bash
bun run setup
```

The setup script replaces the project name and central GitHub repository slug, then prompts for brand, company, operator, postal address, and contact email. The address takes four fields: street, postal code, city, and a two-letter country code such as `US`. Repository links used by the headers, `/llms.txt`, and JSON-LD come from `src/lib/config/site.ts`; legal identity remains in `src/lib/config/legal.ts`. A `legal.ts` that still stores the address as one string needs all four fields once, through prompts or, without a TTY, through `--street`, `--postal-code`, `--city`, and `--country`. Setup prints the old string and writes nothing until all four fields are valid. After running it:

1. Replace `static/logo.svg` with your logo, then run `bun run generate:logos`
2. Refresh email snapshots: `bun run test:unit -- email-snapshots.test.ts -u`
3. Update editorial brand mentions in `src/i18n/{en,de,es,fr}.json` (FAQ, hero copy, pricing tier names)
4. Rewrite the About and Contact placeholders and review the legal copy in `src/lib/content/legal/*.md`
5. Keep the agent summaries in `src/routes/[[lang]]/(marketing)/{about,contact,privacy,terms,impressum}/page.md.ts` aligned with the legal copy
6. Review the optional organization logo, description, and profile links in `src/lib/config/site.ts` and the access limits in `src/lib/content/llms.txt` if your fork adds a public API, MCP server, or agent actions
7. Review the support seed prompt in `src/lib/convex/support/instructions.txt`; development and build commands regenerate its adapter automatically
