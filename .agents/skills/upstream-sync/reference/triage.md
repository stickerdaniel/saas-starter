# Per-commit triage

The review unit is the **squashed first-parent commit** on upstream's default branch.
Upstream squash-merges PRs, so each commit is the canonical, net, reviewed diff of one
PR. Do not pull pre-squash branch commits; they carry intra-PR churn (WIP, fix-the-fix,
reverts that net out) and give worse signal. For an oversized commit, triage _within_ it
by file/hunk instead.

## Order

Process oldest-first; that is the dependency/integration order. Apply security and bug
fixes first, then features/refactors/chores. Review all of them, not only the security
ones.

## Verdict per commit

Reach the verdict from the commit's **actual diff**, not from its priority tag or
category labels. Those are hints (ordering + how much adaptation), never a gate: an
untagged or unlabeled commit still gets read and given a verdict, and is never
blind-applied.

- **integrate.** Applies to this fork. May need adaptation (see divergence-categories.md).
- **already-present.** The fork already has equivalent behavior. Verify before skipping:
  grep the fork for the symbol/string/file the commit adds; check `git log` for an
  independent equivalent. A substring match in a _different_ key/path is not a hit.
- **exclude.** Conflicts with a deliberate fork divergence, or re-introduces something
  the fork intentionally removed/changed (rebrand, font, dropped feature). Record
  `{ "sha": "<sha>", "reason": "<one line>" }` in `.upstream-sync.json.excluded` so the
  next sync does not re-triage it. The marker makes this one permanent, so an unresolved
  verdict is `integrate`: integrating what the fork did not need surfaces in review,
  excluding what it needed surfaces nowhere. Effort is not a conflict, so a large port, or
  one landing in files this fork has rewritten, is `defer`.
- **defer.** Applies, but is too large for this sync (a framework or major-dependency
  migration) or lands in files this fork has rewritten. Ask the human first. Open an
  issue in this fork naming the SHA and record
  `{ "sha": "<sha>", "reason": "deferred to #<issue>" }` in `.upstream-sync.json.excluded`.
  `--mark-synced` moves `lastSynced` past the commit, so the issue is the only thing that
  brings it back.

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

For every "already-present", "exclude", and "defer" verdict, re-verify against the real
file at the cited path before trusting it. Dismissals are where real fixes get silently dropped.

An exclusion cites the fork's version of a line **the commit actually changes**, and
quotes what it says there. Only that file can say whether the changed hunk conflicts.

A consumer of the changed code does not count, however plainly it looks like it would
break. Measured: a commit was excluded because it hardcoded a field the fork's caller
deliberately sets, and the fork turned out to take that field as a parameter, making the
hardcoded value one line to adapt. The reason cited the caller, which was read, and never
named the file the change lands in, which was not. The recheck passed on a real path.

## Oversized commits

A commit touching dozens of files (audit/omnibus PRs) is still one unit, but triage it
file-by-file: some hunks integrate, some are already-present, some conflict with fork
divergence. Resolve each part on its own verdict.

Its message is a sequence, not a statement of intent. Upstream squashes a PR into one
commit carrying a bullet per sub-commit, and the later bullets correct the earlier ones,
so a verdict read off the prose lands on a version that was never merged. Three or more
bullets means the file-by-file pass decides.
