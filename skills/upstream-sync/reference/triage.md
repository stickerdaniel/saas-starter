# Per-commit triage

The review unit is the **squashed first-parent commit** on upstream's default branch.
Upstream squash-merges PRs, so each commit is the canonical, net, reviewed diff of one
PR. Do not pull pre-squash branch commits — they carry intra-PR churn (WIP, fix-the-fix,
reverts that net out) and give worse signal. For an oversized commit, triage _within_ it
by file/hunk instead.

## Order

Process oldest-first; that is the dependency/integration order. Apply security and bug
fixes first, then features/refactors/chores — but review all of them, not just security.

## Verdict per commit

- **integrate** — applies to this fork. May need adaptation (see divergence-categories.md).
- **already-present** — the fork already has equivalent behavior. Verify before skipping:
  grep the fork for the symbol/string/file the commit adds; check `git log` for an
  independent equivalent. A substring match in a _different_ key/path is not a hit.
- **exclude** — conflicts with a deliberate fork divergence, or re-introduces something
  the fork intentionally removed/changed (rebrand, font, dropped feature). Record
  `{ "sha": "<sha>", "reason": "<one line>" }` in `.upstream-sync.json.excluded` so the
  next sync does not re-triage it.

## Cross-commit dependencies (the main trap)

A later commit frequently assumes an earlier one landed:

- a shared helper/module a later commit imports,
- a schema field that an earlier commit made required,
- a new ESLint/CI guard a later commit's code must satisfy,
- a design-token / symbol rename.

Cherry-picking out of order then fails (missing import, type error, lint error). Before
applying, scan the remaining commits for references to anything this commit introduces,
and port prerequisites first or together. Never batch-apply the whole range blind.

## Adversarial recheck of dismissals

For every "already-present" and "exclude" verdict, re-verify against the real file at the
cited path before trusting it — dismissals are where real fixes get silently dropped.

## Oversized commits

A commit touching dozens of files (audit/omnibus PRs) is still one unit, but triage it
file-by-file: some hunks integrate, some are already-present, some conflict with fork
divergence. Resolve each part on its own verdict.
