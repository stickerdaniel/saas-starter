#!/usr/bin/env bun
/**
 * find-fork-point.ts — locate the upstream commit this fork was copied from.
 *
 * Forks of this template are created by content-copy (GitHub "Use this template"),
 * so they share NO git ancestor with upstream: `git merge-base`, `rebase`, and
 * `gh repo sync` do not apply. The only reliable link is TREE-SHA identity — the
 * fork's bootstrap commit copied an upstream tree verbatim, so its tree SHA equals
 * some upstream commit's tree SHA. This script finds that commit.
 *
 * Read-only: it adds + fetches the `upstream` remote and prints results. It never
 * modifies the working tree or writes any file. Persist the result yourself in
 * `.upstream-sync.json` (this script prints a ready-to-commit block).
 *
 * Usage:
 *   bun .agents/skills/upstream-sync/scripts/find-fork-point.ts [--upstream <git-url>] [--json]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// Default upstream = the template this skill ships from (the template's own
// identity, inherited by every fork — not a fork specific). Override via the
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

function readMarker(root: string): Record<string, unknown> | null {
	const p = join(root, MARKER);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, 'utf-8'));
	} catch {
		return null;
	}
}

function main() {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
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
	const marker = readMarker(root);
	const upstreamUrl =
		(values.upstream as string) || (marker?.upstreamUrl as string) || DEFAULT_UPSTREAM;

	// Safety: if this IS the upstream template repo, there is nothing to sync.
	const originUrl = git(['remote', 'get-url', 'origin'], true);
	const norm = (u: string) =>
		u.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
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

	// Fork root = the parentless bootstrap commit (content-copy starts history fresh).
	// If several roots exist, take the oldest by committer date.
	const roots = git(['rev-list', '--max-parents=0', '--date-order', 'HEAD'])
		.split('\n')
		.filter(Boolean);
	const forkRoot = roots[roots.length - 1];
	const forkTree = git(['rev-parse', `${forkRoot}^{tree}`]);

	// Scan upstream history for a commit whose tree SHA is identical (exact match).
	const pairs = git(['log', '--format=%H %T', 'upstream/main']).split('\n').filter(Boolean);
	const matches = pairs.filter((l) => l.endsWith(' ' + forkTree)).map((l) => l.split(' ')[0]);

	let forkPoint: string;
	let method: string;
	if (matches.length >= 1) {
		forkPoint = matches[0]; // newest identical-tree commit (rev-list is newest-first)
		method =
			matches.length === 1
				? 'exact-tree'
				: `exact-tree (${matches.length} identical-tree commits, took newest)`;
	} else {
		// Fallback: bootstrap was edited after copy, so no tree is identical. Pick the
		// upstream commit with the SMALLEST diff to the fork root tree. This is a GUESS.
		console.error(
			'No exact tree-SHA match — bootstrap commit was likely edited. Computing closest tree (GUESS)...'
		);
		let best = '';
		let bestChanges = Number.POSITIVE_INFINITY;
		for (const c of pairs.map((l) => l.split(' ')[0]).slice(0, 400)) {
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
		method = `closest-tree GUESS (~${bestChanges} line diff) — CONFIRM before syncing`;
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
		// Reject anything that is not a real upstream commit — a bogus lastSynced would
		// silently break the next sync's `<lastSynced>..upstream/main` range.
		const resolved = git(['rev-parse', '--verify', '--quiet', `${newLastSynced}^{commit}`], true);
		if (!resolved) {
			console.error(`--mark-synced: "${newLastSynced}" is not a valid commit.`);
			process.exit(1);
		}
		// `merge-base --is-ancestor` signals via exit code (no stdout), so check by throw.
		let reachable = true;
		try {
			execFileSync('git', ['merge-base', '--is-ancestor', resolved, 'upstream/main'], {
				env: gitEnv()
			});
		} catch {
			reachable = false;
		}
		if (!reachable) {
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
		`Last synced:  ${lastSynced}${marker?.lastSynced ? '' : '  (no marker yet — defaults to fork point)'}`
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
