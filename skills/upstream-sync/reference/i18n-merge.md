# i18n conflict resolution: JSON-aware 3-way deep merge

When an upstream commit changes translation JSON the fork has also edited, **never use a
line-based merge resolver** — it corrupts nested objects (orphan commas, duplicated or
broken keys, `"a": {,`). Resolve at the JSON object level.

## The merge

Use git's three stages of the conflicted file:

- `git show :1:src/i18n/<locale>.json` — base (the common version before either side)
- `git show :2:src/i18n/<locale>.json` — ours (the fork's current values)
- `git show :3:src/i18n/<locale>.json` — theirs (upstream's new version)

Deep-merge recursively:

- Start from **ours** (keep the fork's translated values and structure).
- Fold in keys that exist in **theirs** but not in ours (genuinely new upstream keys).
- For a key changed on both sides, keep **ours** (the fork's wording wins) unless the
  upstream change is a structural fix the fork wants.
- Do not re-add a key that ours deliberately deleted from base.

Write valid JSON back (tabs/indent per the repo's prettier config), then run prettier.

## Reconcile locale parity

After merging, every locale must have the same leaf keys as the base locale (usually
`en.json`). New upstream keys must be added to all locales (translate them). Run the
repo's locale guards:

```bash
bun run test:unit -- scripts/locale-parity.test.ts scripts/i18n-used-keys.test.ts
```

If the repo has an orphan-key guard, run it too and prune/allowlist as that skill directs.

## Tolgee ordering (if the fork uses Tolgee)

`bun run i18n:pull` before editing the JSON, `bun run i18n:push` after, so local edits
are not overwritten and changes reach the translation backend.
