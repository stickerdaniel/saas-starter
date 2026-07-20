---
name: upstream-sync
description: Review and integrate upstream saas-starter template changes into a fork. Detects the fork point (forks are content-copies that share no git ancestor), lists every upstream commit since the last sync, and guides reviewing each one to integrate, skip as already-present, or exclude with a reason, adapting to this fork's divergences (branding, theme, env/deploy, i18n, fork-owned features), then ships one consolidated PR. Use when asked to sync or update from upstream, pull template changes, review what the template added, or apply an upstream fix.
argument-hint: '[--type fix|feat|...] [--tag security]'
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Upstream Template Sync

Pull later template changes into this fork. The goal is to review **every** upstream
enhancement, understand it, and integrate what fits — bug fixes, features, refactors,
chores, and security fixes alike. Security fixes are never optional and apply first,
but this is a comprehensive review, not a security-only pass.

This fork was created by **content-copy** (GitHub "Use this template"), so it shares
**NO git ancestor** with upstream: `git merge`, `git rebase`, and `gh repo sync` do
not apply. The link to upstream is tree-SHA identity; every sync is a triaged,
manually-adapted port.

## When to use

- "sync from upstream", "pull template changes", "what did saas-starter add", "apply the upstream fix".

## When to STOP and ask the human

- A candidate commit touches a file this fork has heavily rewritten (auth, schema, deploy config) — show the diff, do not auto-apply.
- Fork-point detection returns a `closest-tree GUESS` (the bootstrap commit was edited) — confirm before proceeding.
- A ported commit needs an env var that does not exist as a preview deployment default.
- Before opening the PR, and before any merge. Never auto-merge.

## Step 1 — Discover (read-only, never writes)

```bash
bun skills/upstream-sync/scripts/find-fork-point.ts        # fork point via tree-SHA match
bun skills/upstream-sync/scripts/list-upstream-changes.ts  # every commit since last sync, oldest-first
```

The list scopes from `.upstream-sync.json`'s `lastSynced` (falls back to the fork
point on the first sync). Each row shows a priority tag, the divergence categories
it touches, and the file count. Oldest-first is the integration/dependency order.
`--json` gives machine output; `--type` / `--tag` narrow the view (review-all stays
the default). The upstream defaults to the template this skill shipped from; if this
fork was forked from another fork, pass `--upstream <url>` (or set `upstreamUrl` in the
marker) to point at the right template.

## Step 2 — Isolated worktree off main

Never work in the shared checkout (a parallel process can sweep up staged files).

```bash
bun run worktree chore/upstream-sync --base main
```

## Step 3 — Detect THIS fork's divergences

Do not assume; detect from the diff against the fork point. Categories: branding/legal
config, theme/design tokens, env/deploy config, i18n content, fork-owned features. See
[reference/divergence-categories.md](reference/divergence-categories.md). A commit
touching a diverged file needs extra care: re-apply the upstream _intent_ onto the
fork's values. A commit that touches no diverged area is **not** a free pass — it still
gets the full Step 4 verdict. Divergence categories change how much adaptation a commit
needs, never whether you review it.

## Step 4 — Review and classify every commit

The priority tag and divergence categories from Step 1 are **hints only** — for
ordering and for how much adaptation a commit needs. They are never a gate or a
substitute for review. Read **every** commit's actual diff and give it an explicit
verdict; never integrate, skip, or exclude a commit from its label alone, and never
blind-apply an untagged or unlabeled commit. "Security first" is about apply order, not
about which commits to look at — you look at all of them.

Process oldest-first (dependency order). Apply security and bug fixes first, then
features/refactors/chores. For each commit, from its diff, decide:

- **Integrate** — applies to this fork (possibly adapted).
- **Already present** — the fork already has equivalent code (grep / `git log` the fork). Skip.
- **Exclude** — conflicts with a deliberate fork divergence, or re-introduces something
  the fork removed. Record `{sha, reason}` in `.upstream-sync.json` so it is not
  re-triaged next sync.

Map **cross-commit dependencies**: a later commit often assumes an earlier one (a
shared helper, a schema column that became required, a new lint/CI guard, a token
rename). Port prerequisites first or together; never batch-apply the whole range.
The review unit is the squashed first-parent commit; for an oversized commit, triage
within it by file/hunk. See [reference/triage.md](reference/triage.md).

## Step 5 — Apply, dependency-aware

Cherry-pick or hand-port in order.

- **Branding/theme/config**: re-apply the upstream _intent_ on the fork's values; never clobber fork branding or tokens.
- **i18n JSON conflicts**: use a JSON-aware 3-way deep merge, NEVER a line-based resolver (it corrupts nested objects). See [reference/i18n-merge.md](reference/i18n-merge.md), then run the locale-parity test.
- Skip any commit that purely reverts a fork choice (rebrand, font, removed feature).

## Step 6 — Validate against WHOLE-PROJECT CI (not file-scoped)

`scripts/static-checks.ts` is file-scoped and misses project-wide gates. Run the
project-wide lint, type check, unit tests, and a build before the PR. A newly ported
ESLint rule fires on ALL pre-existing fork files. If a ported commit adds a typed env
var, ensure it exists as a preview deployment default (CI's `convex deploy` fails on a
missing required var; a green local build does not cover the deploy step). See
[reference/ci-gotchas.md](reference/ci-gotchas.md).

## Step 7 — Ship ONE consolidated PR (never a stack)

One branch off current `main` with all integrated commits, grouped thematically for
readable history but applied in dependency order. Do NOT stack PRs (deleting a stack
base closes its child; rebasing a stack onto a moving main re-conflicts on i18n). List
excluded SHAs + reasons in the PR body. Confirm with the human before opening it; merge
only once the **required** checks are green (a non-required check may stay UNSTABLE).
After merge, persist the marker:
`bun skills/upstream-sync/scripts/find-fork-point.ts --mark-synced <upstreamHEAD>`
(updates `lastSynced` + `syncedAt`), then add any `excluded` entries you recorded and
commit `.upstream-sync.json`.

## Large syncs (many commits): fan out per-commit, not per-category

Run the two discovery scripts once, then parallelize the _triage_ one agent per commit
(plus an adversarial recheck of every dismissal) — the commit is the atomic unit of
intent and the only granularity where cross-commit dependencies are visible. A single
**lead** owns the one worktree branch and is the only writer (serialized commits);
subagents return patches + verdicts + dependency notes as text, the lead applies them
in dependency order. Keep the invariant: one branch, one writer, one consolidated PR.

## Template-bug linkage (do not strip on rebrand)

Keep the AGENTS.md "SaaS Starter Template Bugs" section intact through rebrands; file
template-originated bugs upstream using its issue template. Fixes flow down (this skill);
bug reports flow up.
