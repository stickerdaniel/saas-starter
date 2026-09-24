---
name: shadcn-lint-migration
description: Bring existing code to zero @shadcn/lint findings and enforce each rule as an error, one rule at a time.
disable-model-invocation: true
---

# Migrate code to the @shadcn/lint rules

This skill is temporary. Delete it as tracked in https://github.com/stickerdaniel/saas-starter/issues/977.

Every finding is either drift or a deliberate choice. Drift gets fixed. A deliberate choice survives as a component variant, a theme token, an `@utility`, or a named exception in `eslint/shadcn-policy.js`. The procedure guards against two failures: promoting a one-off value to a new token, and flattening a deliberate customization such as motion, press feedback, or a hover reveal.

The template's decisions are the precedent: the exceptions and their reasons in `eslint/shadcn-policy.js`, the tokens in `src/routes/layout.css`, the component variants, and the template's migration PRs. A fork reuses them and decides anew only where its own design differs, such as its brand colors.

In the template, each rule reaches zero and is then enforced. In a fork, the upstream sync that delivered the rules held back every rule that still had fork findings (see `.agents/skills/upstream-sync/reference/ci-gotchas.md`). The fork is done when its `eslint/shadcn-policy.js` enforces all six rules and every difference from the template's file is a fork exception with its reason.

Keep every artifact in `scratch/shadcn-lint-migration/`.

## 1. Pin the inputs

Fetch trunk and record its SHA. Export that commit with `git archive` into scratch and point every judge at the export, because the shared checkout moves. Pin each external reference by SHA in `SOURCES.txt`: the shadcn-svelte registry for the style in `components.json`, and the `@shadcn/lint` docs at the installed version. An outdated registry clone once produced wrong verdicts for a whole class of findings.

Done when every input a judge reads is a path plus a SHA.

## 2. Measure every finding

Lint the export with a measurement config: the repository's `eslint.config.js` with every `rules` object stripped, `projectService: false`, and all six rules with the template's options. This parser-only run reported the same 1,121 findings as the typed run in the template and finishes in seconds; typed lint needs several GB for 40 files. Count the tracked candidate files, the files ESLint ignores, and the files it linted.

Done when the three counts reconcile, no file has a fatal parse error, and the JSON report covers every linted file.

## 3. Build the ledger

Write one decision unit per rule, file, and line to `ledger.tsv` with the columns `id rule area owner file line component tokens repeats_in_repo fix_kind commit commit_date commit_subject source message`.

- `area` separates registry code: `ui-upstream` is a line as the registry ships it, `ui-modified` a changed line in a registry component, `ui-custom` a component the registry lacks. Other files take their top directory.
- `owner` comes from `bun run upstream:report` in a fork (`template`, `fork`, or `unmeasured`) and stays empty in the template. A `template` finding means the fork changed a template file; compare it with the template's current version first.
- `repeats_in_repo` counts the flagged token, variant prefixes stripped, across all findings of that rule. A value that appears once is a one-off.
- `fix_kind` is `same-value` when the message names an identical scale class, `nearest` when it names a different one, and `none` otherwise.
- `commit`, `commit_date`, and `commit_subject` come from `git blame` of the line at the pinned SHA.

Done when the unit count equals the number of distinct rule, file, and line triples in the report.

## 4. Collect policy questions

Some decisions shape many units, such as how strict `no-restyle` is per component, the email and logo scope, motion tokens, CSS hook classes, and dynamic inline styles. Write each to `policy-items.md` with its evidence and options. In a fork, list only the questions the template's precedent leaves open.

## 5. Judge twice, then resolve disputes

Give every judge the pinned inputs, the ledger, the policy items, and the rules below. Judges read the code and its history for intent; the rule message only names the symptom.

1. A first model judges every unit in one TSV with the columns `id class action value_change confidence depends_on reason`. `class` is `drift`, `deliberate`, `upstream`, `false-positive`, or `unclear`. `action` is `snap:<class>`, `variant:<Component>.<name>`, `token:<name>`, `utility:<name>`, `cssvar`, `exception:<policy>`, `delete`, or `human`. `value_change` is `none` or `visual`. It also returns the closed list of new tokens, variants, and utilities; implementation creates nothing outside that list.
2. A second, different model reviews the first pass adversarially and marks each unit `agree`, `change`, or `unsure` with evidence.
3. For each unit where the two differ, one agent reads the code, the introducing commit, and the rendered behavior, and decides.
4. Every question that trades design intent goes to the human with the options and what changes visibly.

Done when every unit has one final verdict and every policy question has a decision.

## 6. Migrate rule by rule

Each PR takes one rule: apply its verdicts, reach zero findings over every linted file with the real config, enforce the rule in `enforcedShadcnPolicy`, and extend `eslint/shadcn-policy.test.ts`. Typed lint over the whole tree needs chunks of at most 20 files. The template used this order: `no-unknown-classes` with `require-static-classes`, then `no-raw-colors`, `no-inline-styles`, `no-arbitrary-values`, and `no-restyle`.

Done when the rule is an error on trunk.

## Rules for every unit

1. A one-off value snaps to the nearest existing token or scale step. A new token, variant, or utility needs the same value with the same intent in at least two places, or a commit that deliberately introduced it.
2. A value-preserving fix proves identical classes or generated CSS. A fix that changes the value gets before and after screenshots in both themes.
3. Registry code follows the current registry version rather than local edits.
4. Controls own their color, typography, padding, fixed size, and motion through finite variants. Call sites add placement only.
5. An allowed class is listed by exact name, with a comment naming what supplies it.
6. An `eslint-disable-next-line` carries its reason and exists only where a public API must stay unchanged.

These saas-starter customizations show what deliberate looks like: the Button transition list from #803 that makes press translation immediate, the sliding tabs pill from #657 and #752, and `transition-all` on the chat scroll button, which animates its show and hide. A line last touched by a large feature or registry update commit carries no intent on its own.
