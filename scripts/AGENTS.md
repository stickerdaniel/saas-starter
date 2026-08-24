# Scripts, guards, and deployment guidance

## Script portability

All scripts must work on macOS, Linux, and Windows. Use TypeScript executed by Bun for non-trivial logic. Avoid Bash-specific syntax and `sh -c`; use `bun-tasks` for parallel commands.

## Validation

`bun scripts/static-checks.ts <changed files...>` is the primary targeted validation command.

Root `AGENTS.md` decides whether a fix earns a regression guard and which mechanism carries it. Two mappings are specific to this scope:

- environment requirement → Varlock schema
- security header → server hook/config plus a response test

Route content, configuration, and generated assets belong in Vitest or an artifact test. Playwright covers deployed response behavior and load-bearing user flows.

Tests and checks should name the invariant, not mirror a current file list unless that file relationship is itself the contract.

## Deployment

Deployment is push-driven through CI. Never deploy locally with Convex, Wrangler, Vercel, or the bare deploy script. `scripts/deploy.ts` resolves the target and validated environment.

Cloudflare environment values are uploaded through `varlock-wrangler`. Never embed resolved sensitive values into the Worker bundle. Adapter-node and Vercel use their host runtime environment path; keep the Varlock secret-stripping guard intact.

## Environment tooling

- `varlock load` validates resolved configuration.
- `varlock run -- <cmd>` executes with validation and redaction.
- `varlock codegen` regenerates SvelteKit environment types.
- `varlock codegen --path .env-convex.schema` regenerates Convex environment types.
- `varlock scan` checks for leaked values.

## Generated assets

`bun run generate:logos` derives raster/email icons from `static/logo.svg`. After changing the logo, run `bun run build:emails`; do not edit generated logo files independently.

Locale-derived configuration is updated with `bun run i18n:sync` and guarded by `scripts/prerender-sync.test.ts`.
