# Detecting this fork's divergences

A fork diverges from the template in a few predictable areas. Detect them from the actual
diff against the fork point — never hardcode fork specifics. When an upstream commit
touches a file in a diverged area, re-apply the upstream _intent_ on top of the fork's
values; do not clobber the fork's choices.

Get the fork's divergence surface once:

```bash
# files the fork changed vs the template baseline (forkPoint from .upstream-sync.json)
git diff --name-only <forkPoint> HEAD
```

Cross-reference that list with each candidate commit's changed files (the
`list-upstream-changes.ts` output already tags categories per commit).

## Categories (generic shapes)

- **branding / legal** — brand name, wordmark, logo, legal/operator/address config, SEO
  defaults, marketing copy, manifest/favicon. Upstream changes here usually must be
  re-expressed with the fork's brand values, not copied verbatim.
- **theme / design tokens** — global CSS, design tokens, Tailwind theme, color/spacing
  scales, fonts. A fork that re-themed will conflict on token files; keep the fork's
  token values, take only genuinely new tokens or structural fixes.
- **env / deploy config** — env schema, deploy scripts, CI workflows, platform config
  (wrangler/vercel/docker), backend component/config. Adapt to the fork's deploy targets;
  a fork may have disabled a platform the template still ships.
- **i18n content** — translation JSON. Resolve with the JSON-aware 3-way deep merge
  (see i18n-merge.md), never line-based.
- **fork-owned features** — directories/modules the fork added that the template has no
  concept of. Upstream rarely touches these; if a refactor does (e.g. a renamed shared
  helper the fork's feature imports), port the rename into the fork's feature too.

## Decision

- File NOT in the fork's divergence surface → the commit usually applies cleanly (still
  review intent).
- File IN a diverged area → adapt. If the fork rewrote that file heavily (auth, schema,
  deploy config), STOP and show the human the diff rather than auto-applying.
- Commit purely reverts a fork choice (re-adds removed feature, restores template brand
  or font) → exclude with a reason.
