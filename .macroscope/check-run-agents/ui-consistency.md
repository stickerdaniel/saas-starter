---
title: UI Consistency
model: gpt-6-sol
reasoning: xhigh
input: incremental
include:
  - 'src/**/*.svelte'
exclude:
  - 'src/lib/components/ui/**'
  - 'src/lib/components/ai-elements/**'
  - 'src/lib/components/prompt-kit/**'
  - 'src/lib/emails/**'
  - '**/test-fixtures/**'
  - '**/obfuscated-email.svelte'
requires:
  - 'Lint & Format'
maxBudgetPerRun: 2
maxBudgetPerPR: 10
conclusion: neutral
---

# UI consistency review

Enforce the section **Svelte and UI** of the application guide below on the changed lines. The other sections are background. `local/prefer-shadcn-primitives` already flags native buttons, dialogs, checkboxes, selects, text inputs, textareas, and `title` tooltips; this check covers what that rule cannot see.

@/src/AGENTS.md

## What lint cannot see

- New markup that copies an existing component's structure and classes instead of composing or extending it.
- The same treatment written as component-local styles in several places where the guide asks for a shared global utility.
- A shadowed surface with a solid border instead of `ring-1 ring-foreground/10`.
- A decorative, non-functional control left in the accessibility tree.
- An `{#each}` block without a stable key.

The check is done when every rule in the section has been applied to every changed hunk in scope. Findings come from changed lines; older markup in the same file is background.

## Reporting

Post each violation as a brief inline comment on the relevant line: the rule, the primitive or utility to use instead, and nothing more.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
