# Development

The tooling that keeps parallel work, checks, and agent-written changes safe.

## Regression guards

The same mistakes kept showing up across repos. In addition to giving agents good patterns to copy, the codebase enforces its own rules. A recurring bug earns a guard only when the correct path was non-obvious and the mistake remains writable. CI requires every human-authored PR with a conventional `fix` title to include a `Regression guard:` verdict; bot PRs are exempt. The accepted guard fires at the earliest useful point, which can be a type, lint rule, static check, focused test, or targeted instruction.

The full decision rule and the order of mechanisms live in the [Regression guards section of `AGENTS.md`](../AGENTS.md#regression-guards).

## Worktrees

Each worktree gets its own isolated Convex backend, port, and auth secret via [convex-vite-plugin](https://github.com/juliusmarminge/agent-tools/tree/main/packages/convex-vite-plugin). Run `bun run worktree feature/dark-mode --open-editor cursor` (or `code`) to create one with all local env vars copied over, or use the VS Code task. Work on multiple features in parallel without stepping on each other.

## Type-Safe Environment Variables

[varlock](https://github.com/nickreese/varlock) validates env vars against two schemas and generates TypeScript types from them. `.env.schema` covers SvelteKit (Vite), `.env-convex.schema` covers the Convex backend. If a required variable is missing or mistyped, you find out before the app starts.

## Pre-Commit Hooks

Every commit is checked automatically. `static-checks:staged` first runs spell checking, the English prose policy, banned pattern detection (catches deprecated Tailwind tokens, bare `animate-spin`, and similar issues), Prettier, ESLint, and oxlint on staged files only. `varlock scan` then checks the staged changes for leaked secrets.

## Dead Code Detection

[Knip](https://knip.dev/) is configured for SvelteKit file-system routing and Convex backend entry points. It catches unused exports, stale dependencies, and orphaned files so the codebase stays clean. [oxlint](https://oxc.rs/docs/guide/usage/linter) adds a custom Convex rule that flags unused Convex functions at lint time. Knip runs as the last lint-group step of `bun scripts/static-checks.ts`, so the pre-push file run and CI's lint job fail on an orphaned file, an unlisted import, or a dependency nothing uses. Unused exports and exported types stay warnings because barrel re-exports and schema types are API surface. The pre-commit hook skips Knip because it reads the whole working tree.

## Bundle Analysis

Run `ANALYZE=true bun run build` to generate a treemap with gzip and brotli sizes. Helps you spot bloat before it reaches production.

## VS Code Integration

Dev server, static checks, i18n sync, email build, and worktree creation are all available as VS Code tasks via `Run Task` (`Cmd/Ctrl+Shift+P`).

## Dependency Automation

Renovate groups non-major updates into a single PR and creates separate PRs for packages that tend to ship breaking changes (Better Auth, AI SDK, ESLint), so upgrades are easier to review.

## Email Development

HTML email templates are Svelte components compiled to inline HTML on `postinstall` and during builds. `bun run build:emails` renders each HTML template with mock data, and the snapshot test `src/lib/emails/__tests__/email-snapshots.test.ts` catches any unexpected markup change.
