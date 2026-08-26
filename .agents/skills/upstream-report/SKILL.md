---
name: upstream-report
description: Decide whether a change in a content-copy fork belongs in the upstream saas-starter template, and report it there when it does. Use in a fork before opening a PR, after fixing a bug, and whenever an edit touched framework, auth, email, UI-primitive, config, or build code. The saas-starter template itself does not use this skill. A script measures which files are template-derived, so one command answers it and no file is judged by eye. Sends fixes up only; pulling template changes down is upstream-sync, which a human starts.
allowed-tools: Bash, Read, Grep, Glob
---

# Report a fix upstream

This repository was created from the `saas-starter` template by content-copy. Template
code and code written here sit side by side in the same tree, and after a few months
nothing distinguishes them by eye. That costs in both directions: a template bug fixed
only here leaves every other fork carrying it, and fork-only work offered upstream wastes
a maintainer's time.

So measure it. Ask the detector.

## Ask the detector

```bash
bun run upstream:report
```

Run the package script from the repository root. Bun resolves scripts from the current
package, so a nested package such as `voice-gateway/` cannot see this one. Move to the root
first when needed:

```bash
cd "$(git rev-parse --show-toplevel)"
bun run upstream:report
```

Arguments go after `--` and are repository-relative in this form. Invoked by its own absolute
path instead, the script keeps them relative to your directory.

With no arguments it takes every file changed against the merge-base with `origin/main`,
plus staged, unstaged, and untracked work, and both sides of a rename. Pass explicit paths
to narrow the classification list: an explicit path is classified whether or not it changed,
and a directory expands to everything under it. Automatic discovery and aggregate explicit
expansion stop at 500,000 files. Equivalent path arguments are enumerated once. Every argument
must match something, including when its neighbours matched, because git drops an unmatched one
without a word. An explicit run stops if `.upstream-sync.json` changed in the selected commit
range. Run without paths so that parent change stays in the report. Provenance still scans the
bounded current trees and upstream history, because moved template code may live at any path.

Three active flags follow `--`: `--base <ref>` starts from the merge base with that ref
instead of with `origin/main`, `--json` prints machine output, and `--fetch` lets the run
create the remote and fetch its checked URL. Fetch is the only mode that touches Git state.
The old `--all` flag remains accepted for compatibility and has no effect because every
classified path is listed.

Each changed file comes back in one of three classes:

| Class        | Meaning                                                                                                                                                                                                                                                                                                                                          | What to do                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `pristine`   | The path exists upstream and was **identical to it** before this change.                                                                                                                                                                                                                                                                         | Read it.                          |
| `diverged`   | The path exists upstream but had already been rewritten here.                                                                                                                                                                                                                                                                                    | Read it, highest score first.     |
| `unmeasured` | A comparison was unavailable or found a possible tie. Covers absent paths, binary content, missing or shallow history, a missing partial-clone blob, unstaged filtered content, a mode-only change, a submodule, a case-only difference, upstream bytes under another mode or path, a unique filename, and text that resembles an upstream file. | Read it, and check the tie first. |

Every classified path is marked `>>` and stays in the report.

`pristine` is the strongest signal in the tool. Editing template code that this fork had
never touched means the defect is, almost by construction, present upstream too. The local
tree must match `main` currently advertised by the configured `upstream` remote or carry a
URL-bound detector fetch record; another remote may not populate any measured verdict. It takes the mode as well as the bytes, so a symlink standing where
upstream has a regular file is reported and not waved through.

An absent path always stays `unmeasured`. Presence in the bootstrap root proves when the
path appeared, not whether it was moved or rewritten from template code before that first
commit. Negative text resemblance cannot settle ownership either. The detector still checks
case-folded paths and exact blobs across the histories reachable from local HEAD and the
upstream tip, plus the index and captured working tree. Local history follows renames and
copies down to 1% similarity with Git's candidate limit disabled, including paths created
while merging either parent. It then checks filenames that are unique in the current template
and compares text against every historical upstream blob. Those ties explain what to inspect;
a miss leaves the path visible.

The marker needs a `forkPoint` or `lastSynced` commit for provenance checks, and every recorded
commit must remain reachable from the fetched upstream tip. A force-pushed, disconnected
history remains `unmeasured`. The detector searches the same extension first and widens to every
blob, since ports between JavaScript and TypeScript are ordinary. Current upstream blobs are
read in one batch; historical blobs are retained within fixed bounds. The upstream history walk,
object typing, root scan, blob reads, and local ancestry commands have time limits. Local
ancestry, shared-path diffs, source-text preprocessing, and in-process similarity comparisons
also have time or operation-count limits. Reused blobs share their prepared text representation.
Reaching a limit keeps the path `unmeasured`.

A missing blob, shallow history, unsafe symlink path, unreadable or oversized source, binary
input, or an untracked file that disappears during the run also produces `unmeasured`. Re-run
with `--fetch` after checking the configured parent URL when you need the freshest comparison.

The filename and text checks show resemblance, not proof. The report says that on the line.
The text threshold is git's 50% rename similarity. Sixty percent lost the real case this
check was added for. Forty percent started matching generated barrel files that shared only
the same shape. UTF-8 and detected UTF-16 text use the same comparison regardless of extension.
Text also compares overlapping eight-character spans. That catches a small
minified edit and a systematic prefix added to every line. Text
too short to retain a line or an eight-character span stays `unmeasured`. These
checks catch a template file copied to a product path and customised in the same commit,
which has no shared path, blob, or name.

The score on a `diverged` file says how much of what the change replaced still exists
upstream. It takes the strongest hunk across committed, staged, and captured working-tree
states rather than scoring the file as a whole. Per hunk because a file that deletes a
fork-only call in one place and inserts a guard
beside template code in another otherwise scored on the deletion alone, and sorted last.
It ranks the reading order and never gates it: three review rounds each found an input
where a threshold silently dropped a real finding.

A file at or near 0% is the one worth understanding, and it is still a file you read. The
usual reason is that the edit landed in a block this fork added, where upstream has
nothing to receive: adding a table to a schema both repositories have is the everyday
example. The other reason is that this fork had renamed the template's line before fixing
it, so the removed spelling is absent upstream while the bug is not. Line matching cannot
tell those two apart, which is why the score orders your reading and never ends it.

A wholly new file with no measurable tie stays `unmeasured`. A missing CI workflow, lint
rule or framework hook may belong upstream even when the template has no counterpart to
compare. That is a design judgment, so the detector keeps the file visible and leaves the
answer to you.

## Decide, per reported file

Read the actual change. Ask one question: **would this be a fix in a repository that has
none of this fork's features?** Send it upstream only if the answer is yes.

Send it up:

- a bug in template code: wrong logic, a missing guard, a race, an accessibility defect;
- hardcoded English in a template component that a fork cannot localize without editing it;
- a security or correctness fix in auth, email, forms, or session handling;
- a build, lint, or CI defect that every fork inherits.

Keep it here:

- anything naming this product, its domain concepts, its routes, or its branding;
- config, env, or deploy values specific to this deployment;
- a workaround that only makes sense given a fork-only feature;
- translations of fork-owned strings.

Half and half is common: a template component gets both a genuine fix and a fork-specific
extension. Report the fix alone and describe it in template terms, without the fork's
vocabulary.

## Report it

Search first, so a known issue gets a comment instead of a duplicate:

```bash
gh search issues --repo stickerdaniel/saas-starter "<keywords>"
```

Search without a state filter so closed issues come back too. A fix that was already
rejected, or already shipped, is the answer as often as an open ticket is.

If nothing matches, inspect recent reports before writing, so the new issue matches the
repository's current level of detail:

```bash
gh issue list --repo stickerdaniel/saas-starter --state all --limit 5 --json number,title,body
```

**Ask the human before filing.** Drafting is yours; posting to another repository is
theirs. Show the draft, then file it once they agree.

Write the report as it would read to someone who has never seen this fork: the template
file, what goes wrong, how to reproduce it from a clean template, and the fix if you know
it. A report that only makes sense here will be closed here.

## One direction only

This skill sends fixes up. Bringing template changes down into this fork is
`upstream-sync`, which reviews the full commit range, adapts each change to this fork's
divergences, and ships one consolidated PR. A human starts that skill and no one else: a
sync rewrites files across the whole repository, and that is a decision, not a side effect
of having edited an email template.

## When the detector cannot answer

An unavailable file comparison becomes `unmeasured` and stays in the report. The command
exits non-zero when the run itself is incomplete, because an incomplete run looks like
"nothing to report".

It exits with the reason when any of these hold:

- there is no local copy of upstream;
- `refs/remotes/upstream/main` exists but no `upstream` remote does, so nothing ties that
  ref to the template. An orphan left by a former parent fork produces plausible comparisons
  against the wrong tree;
- `.upstream-sync.json` is staged, modified, deleted, ignored or untracked, hidden from Git
  status, differs from the committed HEAD file, is a symlink, is oversized, changes identity or
  bytes while read, is unreadable, contains invalid UTF-8 or JSON, is not an object, has an `upstreamUrl`
  without a non-empty string value, or names `forkPoint` or `lastSynced` without a full commit SHA;
- the `upstream` remote points somewhere other than the URL in `.upstream-sync.json`, origin or the
  marker URL resolves inside any checkout or Git directory owned by this repository, Git rewrites either
  URL through `url.*.insteadOf`, `core.sshCommand` or `core.gitProxy` replaces the checked transport,
  or a remote URL or tracking ref changes before the detector finishes;
- origin, working-tree status, a changed-path diff, or a requested upstream fetch exceeds 30
  seconds, the fetch cannot read `refs/heads/main` from the marker's checked URL, a remote uses
  plain HTTP or another transport outside local files, HTTPS, and SSH, HTTPS disables certificate
  or proxy-certificate verification, or a remote URL carries userinfo, a query, or a fragment.
  The standard `git@` user in SSH and SCP GitHub URLs is allowed;
- `origin/main` is missing and no `--base` was given, its SHA differs from `main` at the
  currently configured origin URL, a `--base` does not resolve, or HEAD and the requested
  base have multiple equally valid merge bases;
- an explicit path argument names nothing, aggregate expansion exceeds 500,000 files,
  `.upstream-sync.json` changed in the selected range, or an option is misspelled, since a stray value
  becomes a path and one path replaces the automatic file list;
- the origin fetch refspec maps anything except `refs/heads/main` into `origin/main`, excludes
  `refs/heads/main`, or the ref differs from `main` currently advertised by the configured origin.
  A successful push update is accepted because the live remote SHA binds it;
- a Git pathname is not valid UTF-8, since JavaScript would collapse distinct raw names into
  the same replacement-character string;
- the repository is a partial clone and Git is older than 2.45, where missing-object reads can
  still fetch lazily during a no-fetch run;
- the Git index is missing or has unresolved merge stages;
- Git reports `core.fileMode=false` on a non-Windows filesystem, so executable-bit changes cannot
  be verified without manufacturing mode differences on filesystems that lack the capability;
- the existing index uses a split backing file. The detector pins `core.splitIndex=false` so
  an ordinary copied index cannot activate one during refresh;
- the private scratch index disappears or its staged entries change during the run;
- the system temporary directory is relative or resolves inside any checkout attached to the
  repository or inside shared Git storage, or Git cannot identify a checkout behind a separate
  Git directory;
- a classified path has `assume-unchanged` or `skip-worktree`, which hides tracked edits from
  Git's status and diff;
- enumerating automatic or explicit paths failed for any reason, since an empty list from a
  broken git call is indistinguishable from an empty list from a clean tree;
- origin's URL, `main` ref, fetch mapping, or reflog provenance changes after base validation;
- HEAD, `.upstream-sync.json`, the caller's index, the shallow boundary, the working-tree status,
  or the bytes of any classified working-tree path change before the report finishes.

Each of those means "unknown", and none of them means "nothing to report". Say which one
you got.

It adds no remote, writes no refs and fetches nothing unless `--fetch` is passed. Default
base resolution reads origin's unexpanded configured URL, rejects a matching `url.*.insteadOf`
rule and any URL owned by this repository's worktrees, and uses `ls-remote` to bind the local
`origin/main` SHA to `main` there. Use an explicitly verified `--base` when origin is offline.
Trusted network commands use hashed remote names in a private bare Git directory with the caller's
object format. The URL lives only in its private config, never in a detector Git argument. POSIX
permissions restrict that file to its owner. Windows reads the marker from the index before touching
its path. It forwards credential helpers, authorization headers, and credential-bearing proxies as
per-process Git config instead of writing them to temporary files. The private config retains safe
global and URL-scoped CA and proxy settings, URL-scoped client certificate settings, and a matching
remote's proxy. Unscoped HTTP authorization stays out because the marker chooses the host. Transport
accepts local files, HTTPS, and SSH. Plain HTTP, Git, FTP, `git+ssh`, and arbitrary remote helpers are
refused. The private config denies unknown protocols and preserves restrictive
`protocol.allow` and `protocol.*.allow` settings. An inherited `GIT_ALLOW_PROTOCOL` is intersected
with the accepted transports and keeps Git's normal override semantics. HTTPS also requires
certificate and proxy-certificate verification. Matching `url.*.insteadOf`,
`core.sshCommand`, and `core.gitProxy` overrides remain refused. A `remote.upstream.uploadpack`
helper cannot serve a different repository. When the marker uses an accepted GitHub alias, transport
keeps the configured remote's exact spelling so its URL-scoped pins, certificates, and proxy settings
still match. A local remote is written under the canonical path that passed checkout-ownership
validation, so retargeting its symlink cannot redirect the later fetch.

Fetch disables automatic maintenance because the private ref namespace does not describe which
objects the real repository still needs. Fetched objects still land in the real object store. The
30-second deadline stops the direct Git process. It does not limit received pack bytes or guarantee
that every remote-helper descendant has exited. Check free disk space before `--fetch` when the
configured parent may be unusually large.
It reads the advertised `main` SHA before and after an object-only fetch that writes neither
`FETCH_HEAD` nor a tracking ref. It verifies that exact commit before creating a missing shared
remote. The URL it just wrote remains the expected value, so a concurrent replacement cannot be
adopted as trusted state. It rejects a symbolic tracking ref, then checks the shared URL around an
unchanged-ref compare-and-swap. A URL race before the write leaves the ref untouched; one immediately
after it rolls the ref back before failing. A failed initial fetch leaves no remote, ref, or fetch
timestamp. Without a
current-run fetch, the local tree may still prove a tie but cannot rule one out. Fetching stays
opt-in because the URL comes from a file the branch controls. Git stderr stays captured
until the detector can redact it. Diagnostics and JSON redact scheme-based and SCP-style
userinfo plus complete query strings and fragments. Repository identity comparisons remove HTTPS
credentials. GitHub's standard HTTPS, SCP-SSH, and `ssh://git@github.com` forms identify the same
repository across letter case, an optional `.git` suffix, and an optional trailing slash, matching
GitHub and the established sync workflow. Every other transport spelling, SSH user, path root,
trailing slash, `.git` suffix, and byte of a local path stays significant because it may select
another repository.

Apart from the explicit `--fetch` Git-state writes, it writes nothing inside the repository. A worktree diff refreshes the index when
stat data moved and content did not, which takes `index.lock` and can fail a concurrent
`git add`. Measured on git 2.55, `GIT_OPTIONAL_LOCKS=0` suppresses the rewrite for `git
status` and not for `git diff`, so each run copies an ordinary index into the system temp
directory. The same scratch directory holds an immutable copy of the shallow boundary and the
private transport repository. Every history read sees one graph even if another Git process
shallows or deepens the shared repository.
The directory must be absolute and outside every checkout attached to the repository and outside
shared Git storage. Scratch creation and cleanup use that validated canonical path, so a retargeted
temp-directory symlink cannot move either operation into the repository. Git follows an
existing split index back to `.git/sharedindex.<sha>` and
touches that file, so the detector checks the copied bytes, refuses a split index, and pins
split-index activation off. It also pins Git's full ctime and stat checks. On POSIX it requires
Git's filesystem probe to report executable-bit support, so repository config cannot hide same-size
or mode-only edits without inventing changes on incapable filesystems. The snapshot records the caller index at the same instant it copies
it, then verifies that the private file and its staged entries survive unchanged. Its initial
status seeds automatic path discovery. Classification opens each regular file without following
the final symlink, verifies the descriptor against the path and its parents, then performs a
bounded read. Capture, retained resemblance data, and shared-path overlap maps have separate
aggregate and representation bounds; content beyond them stays `unmeasured`. A temporary restore or replacement cannot disappear
between matching endpoint snapshots. Each temp directory carries its owner's process
id. Cleanup ignores unowned directories, skips a slow
active report, and removes only abandoned copies older than an hour.
Cleaning up on a signal instead would be worse: the script spends its time inside
synchronous git calls, where a handler cannot run, and installing one only replaces the
default disposition, so the run stops answering `SIGTERM` at all.

One honest limit: Git may apply a `filter.*.clean` driver while status or diff inspects the
working tree. Git LFS is the common case, and it writes to its object cache. There is no
per-invocation switch for it, so the guarantee is "this script writes nothing", not "no byte
moves anywhere". The detector compares captured raw bytes for positive resemblance, then
keeps an otherwise negative unstaged path `unmeasured` because a clean filter may canonicalize
it differently. External diff drivers, textconv filters, promisor lazy-fetches and replacement
refs _are_ refused outright. Git pathspec-mode, namespace, trace-output and command-scope config
variables are scrubbed case-insensitively, including on Windows. Both inherited and repository-local grafts are disabled through the operating system's null
device. Human output, JSON, and fatal diagnostics escape control bytes, C1 controls, Unicode line
separators, and bidirectional formatting characters before they reach a terminal or log viewer.

A shallow repository has an unknown history before its boundary. Exact evidence found inside
the available history still proves a tie; missing history keeps the result `unmeasured`.

An old local copy can miss a tie. Absent paths remain `unmeasured`, and the copy's age explains
how much confidence to place in the available comparisons. Only the newest
tracking-ref movement counts, it must point at the pinned SHA, and its subject must name the
configured `upstream` remote with `main` as the source. A successful detector fetch also records
its SHA, timestamp, and URL fingerprint in local Git config, because a no-op `update-ref` creates no
reflog entry. A no-fetch run otherwise checks the configured remote's live `main`. The tip's commit date is the
labelled fallback. At one full day,
JSON marks the copy stale and the summary refuses a clean verdict. Refresh it with
`bun run upstream:report -- --fetch`; a separate `git fetch upstream` does not record this
run's trust. Measured here on
2026-08-22, a copy fetched two days earlier was twelve commits and seven paths behind a tip
committed the previous day. Changing a remote URL leaves its old tracking ref in place, so
repoint and fetch together.

Run inside the template itself the script exits 2 and reports nothing, because there the
repository is upstream.
