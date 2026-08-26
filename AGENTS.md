# CLAUDE/AGENTS.md

> `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`, not the symlink.

This repository is a SaaS template built with SvelteKit, Svelte 5, Convex, Better Auth, Autumn, Tolgee, and Bun.

## Scope map

The nearest `AGENTS.md` owns task-specific guidance. Read the relevant file before editing that area:

| Scope                             | Guidance                                                 |
| --------------------------------- | -------------------------------------------------------- |
| Application code                  | [`src/AGENTS.md`](./src/AGENTS.md)                       |
| Routes, rendering, forms          | [`src/routes/AGENTS.md`](./src/routes/AGENTS.md)         |
| Convex backend                    | [`src/lib/convex/AGENTS.md`](./src/lib/convex/AGENTS.md) |
| E2E tests                         | [`e2e/AGENTS.md`](./e2e/AGENTS.md)                       |
| Scripts, deployment, build guards | [`scripts/AGENTS.md`](./scripts/AGENTS.md)               |
| Repository documentation          | [`docs/AGENTS.md`](./docs/AGENTS.md)                     |

Skills hold dependency and workflow tutorials. Use the applicable skill instead of copying its contents into an instruction file.

## Template and fork workflow

### Reporting template bugs from a fork

<!-- DO NOT rename or remove this section when rebranding a fork. These links point to the upstream template repo. -->

Template code and fork-owned code share one tree. Measure whether a change came from the template instead of judging it by eye:

```bash
bun run upstream:report
```

The report keeps uncertain files visible as `unmeasured` and reserves `fork-only` for evidence that rules out an upstream tie. An incomplete run exits non-zero. Load `.agents/skills/upstream-report/SKILL.md` to interpret each file, search existing saas-starter issues, and use the repository's issue template. Ask the human before filing.

### Pulling upstream changes into a fork

<!-- DO NOT rename or remove this section when rebranding a fork. -->

A human starts the `upstream-sync` skill (`.agents/skills/upstream-sync/SKILL.md`) with `bun run upstream:sync`, then reviews `bun run upstream:changes`. Forks are content copies without a shared Git ancestor, so ordinary merge, rebase, and repository-sync workflows do not apply.

## Global rules

- English is the default for code, comments, docs, commits, PRs, and chat. User-facing copy is localized; English is the source locale.
- Use Bun, never npm, for project commands.
- Scripts must work on macOS, Linux, and Windows. Use TypeScript with Bun for complex scripts and `bun-tasks` for parallel execution; avoid Bash-specific wrappers.
- For current dependency behavior, use the `btca-local` skill and the resource clones registered in `btca.config.jsonc`.
- When adding a dependency, add its repository to `btca.config.jsonc` and clone it into the btca sandbox after verifying the default branch.

## Workflow

Create work that needs a branch or PR in an isolated worktree:

```bash
bun run worktree <type/short-description>
```

The command fetches and branches from remote trunk by default. Worktrees live beside the main checkout under `<repo>.worktrees/`; branch slashes are flattened only in the directory name. Use `--base` for intentional stacks, `--no-fetch` offline, and `--push-remote upstream` when contributing to another configured remote.

Never use `EnterWorktree`. Prefix every later action with the absolute worktree path because command working directories do not persist. Before committing, run `git branch` and confirm the worktree branch. After a merge, run `bun run worktree:prune`; it safely removes confirmed-merged worktrees and branches and fast-forwards a clean local trunk.

The pre-commit hook intentionally runs fast staged lint only, so commit freely while iterating. Immediately before every push, including after a rebase or CI fix, run `bun scripts/static-checks.ts <all changed files...>` and do not push unless the full lint-and-types check passes.

For reviews and audits, fetch and inspect `origin/main` rather than the shared main checkout, which may intentionally lag behind. Revalidate every finding against that baseline before reporting or changing code.

Open PRs as drafts because ready PRs can auto-merge. Mark a PR ready only after all follow-up work is done, then run `gh pr merge <n> --squash --auto` without `--delete-branch`: the repository deletes merged branches itself, which lets GitHub retarget the next stacked PR onto the merged base. An explicit `--delete-branch` deletes the branch outside the merge flow and force-closes dependent stacked PRs instead. After each merge in a stack, rebase the retargeted PR onto the new base before merging it.

Except for truly small UI-only or docs-only changes, monitor the branch through green required CI, merge it, and verify a green production deployment. If a required check fails, read its provider logs and guide it to green; never override an unexplained failure.

### Commit messages

```text
<type>(scope)[!]: <subject>
```

Scope is required when meaningful. Use imperative mood, capitalize the subject, omit the period, and keep it at most 50 characters. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`. Link issues with `Resolves: #123` or `See also: #456`.

## Where knowledge belongs

A plan is a PR body. An audit finding is an issue. Apply Regression guards below before adding enforcement. A convention with a recognizable source pattern belongs in lint or a static check after it earns a guard; a judgement call without one belongs in the nearest `AGENTS.md` or skill. A code fact belongs in the cheapest faithful test only when behavior is what proves the admitted guard. Repository documents are for knowledge code cannot express: rejected alternatives and rationale, external constraints, external-system runbooks, stable domain/editorial vocabulary, and thin navigation maps.

Never preserve current symbols, signatures, enums, file lists, or implementation steps “for reference.” Split mixed documents: keep the non-derivable rationale and move any admitted guard into the mechanism selected below rather than narrating the current implementation. Historical decisions remain immutable; supersede them with a new dated record and an explicit link.

`knowledge-policy.config.ts` is the executable repository policy. The template default checks relative links and validates decision/runbook metadata when those directories are used, while allowing product forks to keep their own API guides, contribution documents, domain manuals, local READMEs, or stricter document classes. Change the configuration deliberately rather than bypassing the guard.

## Regression guards

A guard stops the next agent from repeating a mistake with fresh context. Fixing something does not earn one.

Build a guard when all three hold:

1. The correct path was not obvious: a wrong first instinct, required research, or a plausible-looking alternative that is subtly wrong.
2. The wrong path is still writable. When a type or API already makes it impossible, that is the guard.
3. The correct pattern fits in one sentence. An unnameable rule cannot be enforced or explained.

Every human-authored PR with a conventional `fix` title puts its verdict in plain text at the start of the body, immediately after an optional `Closes #N` line. Bot-authored PRs such as Renovate updates are exempt:

```text
Regression guard: added <name>
Regression guard: covered by <name>
Regression guard: not warranted, <one-line reason>
```

Pick the earliest mechanism that fires, not the most thorough one. A guard that fires while the agent writes the line teaches the pattern; one that fires in CI reports a failure after the reasoning is already committed.

1. Make it unexpressible: narrow the type, signature, schema, or API.
2. Catch it while writing: an ESLint rule or PreToolUse hook, for any mistake with a recognizable source pattern. State the correct pattern and its reason in the message.
3. Catch it before the push: a static check or build artifact guard.
4. Prove the behavior: a test, when only the outcome separates right from wrong. Take the cheapest layer that fails for the same causal reason, from pure Vitest, `convex-test`, component, SvelteKit HTTP, artifact, and local Playwright through deployed HTTP and deployed Playwright.
5. Write it down: an `AGENTS.md` line or a skill, for judgement calls with no mechanical signature. Weakest option, because it works only when read first.

Guard a rendered detail (DOM ancestry, wrapper placement, CSS class, copy, cosmetic pixels, transition-timed styles) only when that exact property is a published user or platform contract.

A finished mechanical guard fails on the buggy revision for the same causal reason, and its message names the correct pattern. When it does not, move one boundary outward or rewrite the message. A written guard is finished when one sentence names both the triggering situation and the required pattern in the nearest `AGENTS.md` or applicable skill.

## Core commands

- `bun run build` — production build
- `bun run dev` — local Vite + embedded Convex backend
- `bun run dev:cloud` — Vite + cloud Convex backend
- `bun scripts/static-checks.ts <changed files...>` — required after implementation
- `bun scripts/static-checks.ts --scope types` — required once before final handoff or PR for changes to JS, TS, Svelte, Convex, email templates, or Autumn config; pre-commit intentionally runs staged lint only
- `bun run test:unit` — Vitest suite
- `bun run test:e2e` — Playwright suite; required after E2E changes
- `bun run test` — complete test suite
- `bun run check:convex` — required after Convex or Convex-imported shared-code changes

Check whether the development server is already running before starting another one.

## Deployment and environment safety

Deployment is push-driven. Never run `convex deploy`, `wrangler deploy`, or the bare deploy script locally; CI owns deployment credentials and targets.

Two Varlock schemas cover separate runtimes:

| Schema               | Runtime                    | Generated types                  |
| -------------------- | -------------------------- | -------------------------------- |
| `.env.schema`        | SvelteKit / Worker / local | `src/env.d.ts`                   |
| `.env-convex.schema` | Convex backend             | `src/lib/convex/convex-env.d.ts` |

Use `.env.local` for SvelteKit and `.env.convex.local` for the local Convex backend. Never reproduce secrets in docs, logs, commits, or chat. Public browser variables must be declared `@public`; application code uses `$env/static/public` for `PUBLIC_*` variables.

## Plan mode

Keep plans concise. End with unresolved questions only when a user decision is genuinely required.
