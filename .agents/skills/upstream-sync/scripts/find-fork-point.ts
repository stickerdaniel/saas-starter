#!/usr/bin/env bun
/**
 * find-fork-point.ts: locate the upstream commit this fork was created from.
 *
 * A fork of this template is a content copy (the CLI or GitHub "Use this
 * template"), a shared-history clone, or a GitHub fork. The first method that
 * applies decides the fork point, and the output names it:
 *
 *   1. `.upstream-sync.json` forkPoint, recorded by `bun run setup` right after
 *      creation or by an earlier sync. Setup records it at its first run, while the
 *      checkout still has no own commits. A recorded forkPoint or lastSynced that is
 *      not a commit reachable from upstream/main stops the script.
 *   2. `.saas-starter-scaffold.json` sha, written by the CLI. It names the exact
 *      template commit; setup rebrands the copy before its first commit, so no
 *      tree matches. The marker is read as first committed, so a later edit cannot
 *      move the fork point. It must name the configured upstream repository and a
 *      commit reachable from upstream/main, or it is refused.
 *   3. Shared history: the upstream commit where this repository's first-parent
 *      line left upstream. Before any merge this is `git merge-base HEAD
 *      upstream/main`; after `git merge upstream/main` the merge base moves to the
 *      merged tip and would hide the merged commits from review, so it is not used.
 *      The result is UNCONFIRMED: upstream commits fast-forwarded in before the
 *      first own commit look like the creation point. Confirm it, then record it.
 *   4. Exact tree: an upstream commit whose tree SHA equals the root commit's tree,
 *      as in an unedited GitHub template copy.
 *   5. Closest tree: the upstream commit with the smallest diff to the root commit.
 *      This is a GUESS; confirm it before syncing.
 *
 * A shallow clone without a resolvable recorded forkPoint stops with an error,
 * because its cut-off history would look like a content copy.
 *
 * Every creation model reviews the same range, `<lastSynced>..upstream/main`, one
 * upstream commit at a time. A merge that already moved the bytes does not advance
 * lastSynced; only `--mark-synced` after the per-commit review does.
 *
 * It adds + fetches the `upstream` remote and prints results, and touches nothing
 * else in the working tree. Persist the fork point yourself in
 * `.upstream-sync.json` (this script prints a ready-to-commit block).
 *
 * `--mark-synced <sha>` is the one write it performs: it sets
 * `lastSynced` + `syncedAt` in the marker, which is how a finished sync records
 * where the next one starts. Commit that file as the sync branch's final commit.
 *
 * Usage:
 *   bun .agents/skills/upstream-sync/scripts/find-fork-point.ts [--upstream <git-url>] [--json]
 *   bun .agents/skills/upstream-sync/scripts/find-fork-point.ts --mark-synced <upstream-sha>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readScaffoldMarker, SCAFFOLD_MARKER } from './scaffold-marker';

// Default upstream = the template this skill ships from (the template's own
// identity, inherited by every fork, not a fork specific). Override via the
// marker's `upstreamUrl` or `--upstream`.
const DEFAULT_UPSTREAM = 'https://github.com/stickerdaniel/saas-starter.git';
const MARKER = '.upstream-sync.json';

const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];
function gitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const k of SCRUBBED) delete env[k];
	return env;
}
function git(args: string[], allowFail = false): string {
	try {
		return execFileSync('git', args, { encoding: 'utf-8', env: gitEnv() }).trim();
	} catch (err) {
		if (allowFail) return '';
		throw err;
	}
}
// `merge-base --is-ancestor` signals via exit code (no stdout), so check by throw.
function isAncestor(commit: string, of: string): boolean {
	try {
		execFileSync('git', ['merge-base', '--is-ancestor', commit, of], {
			env: gitEnv(),
			stdio: 'ignore'
		});
		return true;
	} catch {
		return false;
	}
}

function readJson(root: string, name: string): Record<string, unknown> | null {
	const p = join(root, name);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, 'utf-8'));
	} catch {
		return null;
	}
}

const norm = (u: string) =>
	u.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
// `owner/name` of a GitHub URL, lowercased; null for any other URL.
function githubSlug(url: string): string | null {
	const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/i.exec(norm(url.trim()));
	return m ? m[1]!.toLowerCase() : null;
}

/** Method 2: the CLI's scaffold marker, or null with the refusal reason on stderr. */
function scaffoldForkPoint(
	root: string,
	upstreamUrl: string
): { sha: string; method: string } | null {
	const read = readScaffoldMarker(root);
	if (!read) return null;
	const scaffold = read.marker;
	const method = read.committed
		? `${SCAFFOLD_MARKER} sha`
		: `${SCAFFOLD_MARKER} sha (uncommitted marker, read from the working tree)`;
	if (read.editedSha !== undefined) {
		console.error(
			`${SCAFFOLD_MARKER} was edited after its first commit (sha ${String(read.editedSha)} now, ` +
				`${String(scaffold.sha)} committed). Using the committed original.`
		);
	}
	const refuse = (why: string) => {
		console.error(`Ignoring ${SCAFFOLD_MARKER}: ${why}`);
		return null;
	};
	const source = typeof scaffold.source === 'string' ? scaffold.source.toLowerCase() : '';
	if (!source || source !== githubSlug(upstreamUrl)) {
		return refuse(`its source "${String(scaffold.source)}" is not the upstream ${upstreamUrl}.`);
	}
	const sha = typeof scaffold.sha === 'string' ? scaffold.sha : '';
	if (!/^[0-9a-f]{40}$/.test(sha)) return refuse('its sha is not a full commit SHA.');
	if (!git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], true)) {
		return refuse(`${sha.slice(0, 8)} is not a commit in the fetched upstream.`);
	}
	if (!isAncestor(sha, 'upstream/main')) {
		return refuse(`${sha.slice(0, 8)} is not reachable from upstream/main.`);
	}
	return { sha, method };
}

/** Method 3: where this repository's first-parent line left upstream, or null. */
function sharedHistoryForkPoint(): string | null {
	const mergeBase = git(['merge-base', 'HEAD', 'upstream/main'], true);
	if (!mergeBase) return null;
	const own = git(['rev-list', '--first-parent', 'HEAD', '--not', 'upstream/main'])
		.split('\n')
		.filter(Boolean);
	const oldestOwn = own.at(-1);
	const left = oldestOwn
		? git(['rev-parse', '--verify', '--quiet', `${oldestOwn}^1`], true)
		: git(['rev-parse', 'HEAD']);
	return left && isAncestor(left, 'upstream/main') ? left : mergeBase;
}

function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			upstream: { type: 'string' },
			json: { type: 'boolean', default: false },
			// Persist the marker after a successful sync: --mark-synced <upstreamSha>
			// (omit the value to use the current upstream HEAD). This is the only
			// write path; without it the script is strictly read-only.
			'mark-synced': { type: 'string' }
		},
		strict: false
	});

	const root = git(['rev-parse', '--show-toplevel']);
	const marker = readJson(root, MARKER);
	const upstreamUrl =
		(values.upstream as string) || (marker?.upstreamUrl as string) || DEFAULT_UPSTREAM;

	// Safety: if this IS the upstream template repo, there is nothing to sync.
	const originUrl = git(['remote', 'get-url', 'origin'], true);
	if (originUrl && norm(originUrl) === norm(upstreamUrl)) {
		console.error(
			'This repository IS the upstream template (origin === upstream). Nothing to sync.\n' +
				'Run this skill from a fork created from the template instead.'
		);
		process.exit(2);
	}

	// Ensure the `upstream` remote exists and points at the template, then fetch.
	const existing = git(['remote', 'get-url', 'upstream'], true);
	if (!existing) git(['remote', 'add', 'upstream', upstreamUrl]);
	else if (norm(existing) !== norm(upstreamUrl))
		git(['remote', 'set-url', 'upstream', upstreamUrl]);
	console.error(`Fetching upstream (${upstreamUrl}) ...`);
	git(['fetch', '--quiet', 'upstream']);

	let forkPoint: string;
	let method: string;
	// A recorded commit outside upstream would silently empty or widen the review range.
	for (const field of ['forkPoint', 'lastSynced'] as const) {
		const value = marker?.[field];
		if (value === undefined) continue;
		const resolved =
			typeof value === 'string' && value
				? git(['rev-parse', '--verify', '--quiet', `${value}^{commit}`], true)
				: '';
		if (!resolved || !isAncestor(resolved, 'upstream/main')) {
			console.error(
				`${MARKER} ${field} ${JSON.stringify(value)} is not a commit reachable from ` +
					`upstream/main (${upstreamUrl}). Correct or remove it, then run this again.`
			);
			process.exit(1);
		}
	}
	const recorded = marker?.forkPoint as string | undefined;
	if (!recorded && git(['rev-parse', '--is-shallow-repository'], true) === 'true') {
		console.error(
			'This repository is a shallow clone, so its cut-off history cannot show where it ' +
				'left upstream.\nFetch the full history first: `git fetch --unshallow origin` ' +
				'(or `git fetch --unshallow upstream` for a clone made with --origin upstream), ' +
				`or record the fork point as forkPoint in ${MARKER}. Then run this again.`
		);
		process.exit(1);
	}
	const scaffolded = recorded ? null : scaffoldForkPoint(root, upstreamUrl);
	const shared = recorded || scaffolded ? null : sharedHistoryForkPoint();
	if (recorded) {
		forkPoint = recorded;
		method = `${MARKER} forkPoint`;
	} else if (scaffolded) {
		forkPoint = scaffolded.sha;
		method = scaffolded.method;
	} else if (shared) {
		forkPoint = shared;
		method =
			'shared history (first-parent fork point) UNCONFIRMED: upstream commits ' +
			'fast-forwarded in before the first own commit cannot be told apart; CONFIRM it, ' +
			`then record it as forkPoint in ${MARKER}`;
	} else {
		// Content copy: history starts fresh at a parentless bootstrap commit. If
		// several roots exist, take the oldest by committer date.
		const roots = git(['rev-list', '--max-parents=0', '--date-order', 'HEAD'])
			.split('\n')
			.filter(Boolean);
		const forkRoot = roots.at(-1);
		if (!forkRoot) throw new Error('No root commit found in the fork history.');
		const forkTree = git(['rev-parse', `${forkRoot}^{tree}`]);

		// Scan upstream history for a commit whose tree SHA is identical (exact match).
		const pairs = git(['log', '--format=%H %T', 'upstream/main']).split('\n').filter(Boolean);
		const matches = pairs.filter((l) => l.endsWith(' ' + forkTree)).map((l) => l.split(' ')[0]);

		if (matches.length >= 1) {
			forkPoint = matches[0]!; // newest identical-tree commit (rev-list is newest-first)
			method =
				matches.length === 1
					? 'exact-tree'
					: `exact-tree (${matches.length} identical-tree commits, took newest)`;
		} else {
			// Fallback: bootstrap was edited after copy, so no tree is identical. Pick the
			// upstream commit with the SMALLEST diff to the fork root tree. This is a GUESS.
			console.error(
				'No exact tree-SHA match; the bootstrap commit was likely edited. Computing closest tree (GUESS)...'
			);
			let best = '';
			let bestChanges = Number.POSITIVE_INFINITY;
			for (const c of pairs.map((l) => l.slice(0, l.indexOf(' '))).slice(0, 400)) {
				const stat = git(['diff', '--shortstat', forkTree, `${c}^{tree}`], true);
				const n = [...stat.matchAll(/(\d+) (insertion|deletion)/g)].reduce(
					(a, m) => a + Number(m[1]),
					0
				);
				if (n < bestChanges) {
					bestChanges = n;
					best = c;
				}
			}
			forkPoint = best;
			method = `closest-tree GUESS (~${bestChanges} line diff); CONFIRM before syncing`;
		}
	}

	const forkPointSubject = git(['log', '-1', '--format=%s', forkPoint], true);
	const upstreamHead = git(['rev-parse', 'upstream/main']);
	const lastSynced = (marker?.lastSynced as string) || forkPoint;
	const ahead = git(
		['rev-list', '--count', '--no-merges', '--first-parent', `${lastSynced}..upstream/main`],
		true
	);

	const suggestedMarker = {
		upstreamUrl,
		forkPoint,
		lastSynced,
		syncedAt: (marker?.syncedAt as string) || null,
		excluded: (marker?.excluded as unknown[]) || []
	};

	// Write path (opt-in): persist the marker after a successful sync.
	const mark = values['mark-synced'] as string | boolean | undefined;
	if (mark !== undefined) {
		const newLastSynced = typeof mark === 'string' && mark ? mark : upstreamHead;
		// Reject anything that is not a real upstream commit; a bogus lastSynced would
		// silently break the next sync's `<lastSynced>..upstream/main` range.
		const resolved = git(['rev-parse', '--verify', '--quiet', `${newLastSynced}^{commit}`], true);
		if (!resolved) {
			console.error(`--mark-synced: "${newLastSynced}" is not a valid commit.`);
			process.exit(1);
		}
		if (!isAncestor(resolved, 'upstream/main')) {
			console.error(`--mark-synced: ${resolved.slice(0, 8)} is not reachable from upstream/main.`);
			process.exit(1);
		}
		const written = {
			...suggestedMarker,
			lastSynced: resolved,
			syncedAt: new Date().toISOString()
		};
		writeFileSync(join(root, MARKER), JSON.stringify(written, null, '\t') + '\n', 'utf-8');
		console.error(`Wrote ${MARKER}: lastSynced=${resolved.slice(0, 8)}. Review and commit it.`);
		return;
	}

	if (values.json) {
		console.log(
			JSON.stringify(
				{
					forkPoint,
					method,
					forkPointSubject,
					upstreamHead,
					candidateCount: Number(ahead) || 0,
					suggestedMarker
				},
				null,
				2
			)
		);
		return;
	}

	console.log('');
	console.log(`Fork point:   ${forkPoint}  (${method})`);
	console.log(`              ${forkPointSubject}`);
	console.log(
		`Last synced:  ${lastSynced}${marker?.lastSynced ? '' : '  (no marker yet, defaults to fork point)'}`
	);
	console.log(`Upstream HEAD: ${upstreamHead}`);
	console.log(
		`Candidate commits to review: ${ahead || '0'}  (git log --no-merges --first-parent ${lastSynced.slice(0, 8)}..upstream/main)`
	);
	console.log('');
	console.log(`Next: bun .agents/skills/upstream-sync/scripts/list-upstream-changes.ts`);
	console.log('');
	console.log(`Suggested ${MARKER} (or run --mark-synced after a successful sync):`);
	console.log(JSON.stringify(suggestedMarker, null, '\t'));
}

if (import.meta.main) main();
