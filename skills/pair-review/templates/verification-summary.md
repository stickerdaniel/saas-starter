Plan updated. Iteration {ITERATION}/5.

## Verification of previous findings

### {finding.id}: {finding.title}

- Verdict: {real | false-positive | accept-out-of-scope}
- Evidence: {file:line, web source, btca, doku, code inspection}
- Action: {what changed in plan, or why nothing changed}

## Plan diff summary

{1-3 sentences pro betroffener Sektion}

## Current plan content

```markdown
{full current plan}
```

## Request

Full fresh review of the entire plan. Re-read end-to-end. Surface all issues, not just changes. Previous findings above are listed so you don't re-raise resolved ones — they are not the scope of this review.

For each previous finding: confirm fix, or maintain with new evidence (don't repeat the original argument). Check for regressions my fixes introduced. Re-audit untouched sections.

PASS only if the whole plan holds end-to-end. No nitpicks, no padding, no PASS just because previously-flagged issues are addressed.

Output format:

First line: VERDICT: <PASS|FAIL|PARTIAL>
Second line: SUMMARY: <one sentence>
Then for each finding, a block in this exact form:

## F<n> [P1|P2|P3] <category> <file>:<line>

<description, can span multiple lines>
Suggested: <action>

No prose outside finding blocks. Empty findings list = no '## F' blocks at all.
