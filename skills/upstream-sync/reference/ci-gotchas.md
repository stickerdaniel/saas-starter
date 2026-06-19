# CI gotchas a local file-scoped check misses

A green `scripts/static-checks.ts` (file-scoped) and a green local `build` do NOT cover
the gates that fail an upstream-sync PR in CI. Check these explicitly before the PR.

## 1. Whole-project lint, not file-scoped

CI runs the project-wide `lint` script (`eslint .` + `oxlint`). When a ported commit adds
a new ESLint rule, that rule fires on **all pre-existing fork files**, not just the files
the commit changed — so a file-scoped check passes while CI fails. Always run the full
project lint before the PR:

```bash
bun run lint        # eslint . && oxlint, the same gate CI runs
```

Fix every pre-existing violation the new rule surfaces (it is part of integrating the
rule), or the rule's PR cannot merge.

## 2. Typed-env deploys need a preview default

If a ported commit adopts typed environment variables (declaring required vars that the
backend deploy validates), the CI deploy step runs the backend deploy and **fails on a
missing required var** — even though the local build never deploys. For each newly
required var, ensure it exists as a preview deployment default (and in production) before
merging. A required var that is set dynamically per-deploy must still have a default so
the presence check passes.

## 3. The deploy step is push-driven

Deploy runs in CI, not locally. A green local build proves compilation, not deployability.
Backend-deploy permission/secret problems (e.g. a deploy key lacking a permission a new
command needs) only surface in the CI build log — read it there rather than trusting the
local build.

## 4. Merge state

The required checks are what gate the merge. A non-required check (e.g. a third-party PR
sync bot) can keep the PR's overall state `UNSTABLE` permanently; merge once the
**required** set is green rather than waiting for a clean overall state.

## Pre-PR checklist

```bash
bun run lint            # whole-project (eslint . + oxlint)
bun run check:convex    # or the repo's backend typecheck
bun run test:unit
bun run build
```
