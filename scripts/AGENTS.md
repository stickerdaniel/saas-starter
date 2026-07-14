# Scripts, guards, and deployment guidance

## Script portability

All scripts must work on macOS, Linux, and Windows. Use TypeScript executed by Bun for non-trivial logic. Avoid Bash-specific syntax and `sh -c`; use `bun-tasks` for parallel commands.

## Validation

`bun scripts/static-checks.ts <changed files...>` is the primary targeted validation command. Add regression guards at the closest executable layer:

- source pattern or convention → ESLint/static check
- pure behavior or configuration relationship → Vitest
- public route or user flow → Playwright
- generated/build artifact → build script plus artifact test
- environment requirement → Varlock schema
- security header → server hook/config plus response test

Tests and checks should name the invariant, not mirror a current file list unless that file relationship is itself the contract.

## Deployment

Deployment is push-driven through CI. Never deploy locally with Convex, Wrangler, Vercel, or the bare deploy script. `scripts/deploy.ts` resolves the target and validated environment.

Cloudflare environment values are uploaded through `varlock-wrangler`. Never embed resolved sensitive values into the Worker bundle. Adapter-node and Vercel use their host runtime environment path; keep the Varlock secret-stripping guard intact.

## Environment tooling

- `varlock load` validates resolved configuration.
- `varlock run -- <cmd>` executes with validation and redaction.
- `varlock typegen` regenerates SvelteKit environment types.
- `varlock typegen --path .env-convex.schema` regenerates Convex environment types.
- `varlock scan` checks for leaked values.

## Generated assets

`bun run generate:logos` derives raster/email icons from `static/logo.svg`. After changing the logo, run `bun run build:emails`; do not edit generated logo files independently.

Locale-derived configuration is updated with `bun run i18n:sync` and guarded by `scripts/prerender-sync.test.ts`.
