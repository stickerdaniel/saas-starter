# Choose an update model

How you create your project decides how it receives later starter changes, so choose before you create it:

- **CLI or GitHub template** ([Quick Start](getting-started.md#quick-start)): a content copy with its own history and visibility. A GitHub template starts with a single commit; the CLI creates a directory without a Git repository, so initialize, commit, and publish it yourself first. Neither shares a Git ancestor with this repository, so an ordinary merge or rebase has no common base to work from.
- **Shared-history clone**: keeps this repository as `upstream` and pushes to your own `origin`, so `git merge upstream/main` can bring later changes in. Your repository carries the full starter history and has no GitHub "Sync fork" relationship.
- **GitHub fork**: keeps the full history in this repository's fork network. A fork of this public repository stays public, cannot change its visibility on its own, and shares pushed commits with the whole network. When upstream changes conflict with yours, GitHub's "Sync fork" offers a pull request and `gh repo sync` stops; its `--force` flag would discard your commits, so resolve conflicts by merging `upstream/main` locally or through that pull request.

Every model takes later changes through the [upstream-sync skill](../.agents/skills/upstream-sync/SKILL.md), started with `bun run upstream:sync` and `bun run upstream:changes`. It reviews each upstream commit by intent and adapts it to what your product changed. A merge into a clone or fork moves the bytes, and the skill still reviews every commit that merge brought in.

For a shared-history clone, create an empty repository for your product, then run:

```bash
git clone --origin upstream https://github.com/stickerdaniel/saas-starter.git my-saas-product
cd my-saas-product
git remote add origin https://github.com/<you>/my-saas-product.git
git push -u origin main
```

For a fork, run `gh repo fork stickerdaniel/saas-starter --clone --fork-name my-saas-product`. Continue either path with `bun install`, [`bun run setup`](getting-started.md#rebrand-the-template), and `bun run dev`.

`bun run setup` deletes the maintainer CLI (`packages/create-saas-starter` and `.github/workflows/create-saas-starter.yml`) and rebrands files including the README, so review every upstream merge into a clone or fork deliberately. Keep your values in rebranded files, check that the merged README gained no `template-only` sections, and resolve modify/delete conflicts by keeping setup's deletions:

```bash
git rm -r --ignore-unmatch packages/create-saas-starter .github/workflows/create-saas-starter.yml
```

An ordinary merge cannot connect an existing content copy to this history, because it has no common base to work from. To switch models, create a branch from `upstream/main` and replay your product changes onto it.

## Send fixes back upstream

Template code and product code share one tree. `bun run upstream:report` measures which of your changes came from template code, so a fix found in one product can reach the others. The [upstream-report skill](../.agents/skills/upstream-report/SKILL.md) explains how to read the report and file the fix against this repository.
