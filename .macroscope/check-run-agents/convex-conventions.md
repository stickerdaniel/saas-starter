---
title: Convex Conventions
model: gpt-6-sol
reasoning: xhigh
input: incremental
include:
  - 'src/lib/convex/**/*.ts'
exclude:
  - '**/_generated/**'
  - '**/__tests__/**'
  - '**/*.test.ts'
requires:
  - 'Lint & Format'
maxBudgetPerRun: 3
maxBudgetPerPR: 15
conclusion: neutral
---

# Convex conventions review

Enforce the sections **Authentication and authorization**, **Platform and durability rules**, and **Load and scheduling** of the backend guide, and the Convex guidelines after it, on the changed lines. The other sections are background. Syntax, validators, and table names are already linted; runtime bugs in general belong to the Correctness check.

@/src/lib/convex/AGENTS.md

@/.agents/skills/convex-guidelines/SKILL.md

## Tracing

A rule is judged on the code behind a changed line, not the line alone:

- For a public function (`query`, `mutation`, `action`, or the wrappers in `src/lib/convex/functions.ts`), find where the caller's identity comes from, and check every document it reads or writes through a caller-supplied id against that identity.
- For scheduling code (`crons.ts`, `ctx.scheduler`), follow the target and name what it writes when there is no work, and what it schedules next.
- For a `.collect()` or a loop over a query, name the bound: an index equality with a small fan-out, a table only admins grow, or none.
- For an import added to a module that exports queries, name what it loads at the top level.

The check is done when every rule in those sections and the guidelines has been applied to every changed hunk in scope. Findings come from changed lines; older code in the same file is background.

## Reporting

Post each violation as an inline comment on the smallest relevant range: the rule, the flow that breaks it, and the fix the guide prescribes.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
