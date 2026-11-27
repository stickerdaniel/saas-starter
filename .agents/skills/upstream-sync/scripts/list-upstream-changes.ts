#!/usr/bin/env bun
/**
 * list-upstream-changes.ts: list upstream commits to review for this fork.
 *
 * Lists every upstream commit since the last sync (or the fork point) so EACH can
 * be reviewed, understood, and consciously integrated or excluded. This is not a
 * security-only tool: all enhancements are candidates. Each commit gets a priority
 * tag (security highest) and the divergence categories it touches, and nothing is
 * filtered out by default, so every commit stays in view. A commit whose files all belong to
 * the path sets the marker's `omitted` names gets the label `omitted-only` and stays listed.
 *
 * Unit of review = the first-parent commit on upstream's default branch. Upstream lands
 * each PR as one such commit, a squash or a merge commit, so each is the canonical, net,
 * reviewed unit of "what landed"; a merge commit's diff is taken against its first
 * parent. Do NOT drop to the PR's branch commits (intra-PR churn, worse signal). For an
 * oversized commit, triage WITHIN it by file/hunk.
 *
 * Read-only: prints only, never writes. Commits are listed oldest-first, which is
 * the dependency/integration order.
 *
 * Usage:
 *   bun .agents/skills/upstream-sync/scripts/list-upstream-changes.ts [--json] [--type <t>] [--tag security]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
	FLAT_TREE,
	inPathSets,
	isPathSetNameList,
	type PathSetName,
	type Tree
} from '../../../../scripts/path-sets';
import {
	layoutOf,
	workspaceAt,
	WORKSPACES,
	type Layout,
	type StarterWorkspace
} from '../layout/v3';
import { staleMarkerMessage } from './stale-marker';

const MARKER = '.upstream-sync.json';
const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];
function gitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const k of SCRUBBED) delete env[k];
	return env;
}
function gitOutput(args: string[], allowFail: boolean): string {
	try {
		return execFileSync('git', args, {
			encoding: 'utf-8',
			env: gitEnv(),
			maxBuffer: 64 * 1024 * 1024
		});
	} catch (err) {
		if (allowFail) return '';
		throw err;
	}
}
function git(args: string[], allowFail = false): string {
	return gitOutput(args, allowFail).trim();
}

const TREES: Record<Layout, Tree> = {
	flat: FLAT_TREE,
	workspace: {
		layout: 'workspace',
		workspaces: Object.values(WORKSPACES).map(({ root }) => root)
	}
};

/** One side of a changed path: the path at one revision, that revision's layout and the path's owner. */
export interface ChangeSide {
	readonly path: string;
	readonly layout: Layout;
	readonly owner: StarterWorkspace;
}

export function changeSide(path: string, layout: Layout): ChangeSide {
	return { path, layout, owner: workspaceAt(path) };
}

/** A `git show --name-status` record: the status letter and the old path first for a rename or copy. */
export interface ChangeRecord {
	readonly status: string;
	readonly paths: readonly string[];
}

/**
 * The sides of a record. The old path takes the layout of the commit's first parent and the new
 * path the layout of the commit; an added path has only the new side and a deleted one only the old.
 */
export function changeSides(
	{ status, paths }: ChangeRecord,
	layouts: { readonly parent: Layout; readonly commit: Layout }
): ChangeSide[] {
	const [before = '', after = before] = paths;
	if (status.startsWith('A')) return [changeSide(before, layouts.commit)];
	if (status.startsWith('D')) return [changeSide(before, layouts.parent)];
	return [changeSide(before, layouts.parent), changeSide(after, layouts.commit)];
}

// Divergence categories: which fork-divergence area a changed path belongs to.
// Generic shapes, not fork specifics. Used to flag commits that need adaptation.
const CATEGORY_RULES: Array<[string, (side: ChangeSide) => boolean]> = [
	['i18n', ({ path }) => /^src\/i18n\/|\bmessages?\/|\.ftl$/.test(path)],
	[
		'theme',
		({ path }) =>
			/layout\.css$|app\.css$|ui\/tokens\.css$|tailwind|theme|design-?tokens|design-?system/i.test(
				path
			)
	],
	[
		'env/deploy',
		({ path }) =>
			/^\.env|wrangler|vercel|fly\.|dockerfile|^scripts\/deploy|convex\.config|\.github\/workflows\//i.test(
				path
			)
	],
	['branding', ({ path }) => /legal|brand|marketing|logo|seo|manifest|favicon/i.test(path)],
	[
		'backend',
		({ path, layout, owner }) =>
			layout === 'workspace'
				? owner === 'backend'
				: /^src\/lib\/(?:convex|confect|convex-components)\/|^convex\//.test(path)
	],
	['tests', ({ path, layout }) => inPathSets(TREES[layout], path, ['tests'])],
	[
		'config',
		({ path }) =>
			/package\.json$|tsconfig|eslint|oxlint|\.prettier|knip|components\.json$|svelte\.config/i.test(
				path
			)
	]
];
export function categoriesFor(sides: readonly ChangeSide[]): string[] {
	const hit = new Set<string>();
	for (const side of sides) for (const [cat, rule] of CATEGORY_RULES) if (rule(side)) hit.add(cat);
	return [...hit];
}

// Security signals. Lean toward catching (this is a review-all tool, so a missed
// tag is worse than an early look): keep secret/credential handling. Only "injection"
// is qualified, because bare "injection" matches the common phrase "dependency
// injection" and would mis-tag ordinary refactors.
const SECURITY_RE =
	/\b(cve-\d+|vulnerab(?:le|ility)|\brce\b|\bxss\b|\bcsrf\b|\bssrf\b|auth(?:n|z)?[ -]?bypass|(?:sql|code|command|html|ldap|xpath|template|header|prompt)[ -]?injection|sanitiz(?:e|ation|ing)|secret|credential|exfiltrat)\b/;

export function classify(subject: string, author: string): { priority: string; type: string } {
	const s = subject.toLowerCase();
	const security =
		/\[security\]/.test(s) || SECURITY_RE.test(s) || /^(fix|chore|sec)\((auth|security)\)/.test(s);
	const m = subject.match(/^(\w+)(\([^)]*\))?!?:/);
	const type = m?.[1]?.toLowerCase() ?? 'other';
	const isBot = /(renovate|dependabot)\[bot\]/i.test(author);
	// Bot dependency bumps are routine chores even when typed fix(deps); only a real
	// security signal lifts them above chore.
	const priority = security ? 'security' : isBot ? 'chore' : type === 'fix' ? 'fix' : type;
	return { priority, type };
}

/**
 * Whether a commit is listed in the marker's `excluded` entries. Entries hold
 * abbreviated SHAs, and git lengthens `%h` as the repository grows, so an entry
 * matches every commit whose full SHA starts with it.
 */
export function isExcluded(fullSha: string, excludedShas: readonly string[]): boolean {
	return excludedShas.some((sha) => sha.length >= 7 && fullSha.startsWith(sha.toLowerCase()));
}

/** The records of `git show -z --name-status`. */
function changeRecords(output: string): ChangeRecord[] {
	const fields = output.split('\0').filter(Boolean);
	const records: ChangeRecord[] = [];
	for (let index = 0; index < fields.length;) {
		const status = fields[index] ?? '';
		const count = /^[RC]/.test(status) ? 2 : 1;
		records.push({ status, paths: fields.slice(index + 1, index + 1 + count) });
		index += 1 + count;
	}
	return records;
}

/** A commit whose every side lies in the sets this project omits; it still gets reviewed. */
export function isOmittedOnly(
	sides: readonly ChangeSide[],
	omitted: readonly PathSetName[]
): boolean {
	return (
		sides.length > 0 && sides.every(({ path, layout }) => inPathSets(TREES[layout], path, omitted))
	);
}

function main() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			json: { type: 'boolean', default: false },
			type: { type: 'string' },
			tag: { type: 'string' }
		},
		strict: false
	});

	const stale = staleMarkerMessage(gitEnv());
	if (stale) {
		console.error(stale);
		process.exit(1);
	}

	const root = git(['rev-parse', '--show-toplevel']);
	let marker: Record<string, unknown> | null = null;
	if (existsSync(join(root, MARKER))) {
		try {
			marker = JSON.parse(readFileSync(join(root, MARKER), 'utf-8'));
		} catch {
			marker = null;
		}
	}
	let base = (marker?.lastSynced as string) || (marker?.forkPoint as string);
	if (!base) {
		// First run, no marker yet: derive the fork point from the sibling script.
		console.error('No marker yet, deriving fork point via find-fork-point.ts ...');
		const out = execFileSync('bun', [join(import.meta.dirname, 'find-fork-point.ts'), '--json'], {
			encoding: 'utf-8',
			env: gitEnv(),
			maxBuffer: 16 * 1024 * 1024
		});
		base = JSON.parse(out).forkPoint;
	}
	git(['fetch', '--quiet', 'upstream'], true);

	const excluded = ((marker?.excluded as Array<{ sha?: string }>) || []).flatMap((e) =>
		e.sha ? [e.sha] : []
	);
	const omitted = marker?.omitted ?? [];
	if (!isPathSetNameList(omitted)) {
		console.error(`${MARKER} has an invalid omitted list: ${JSON.stringify(omitted)}`);
		process.exit(1);
	}

	// Oldest-first first-parent commits since base, merge commits included; %x09 = tab field
	// sep. The full SHA only matches excluded entries; output keeps the short one.
	const raw = git([
		'log',
		'--first-parent',
		'--reverse',
		'--format=%h%x09%H%x09%an%x09%s',
		`${base}..upstream/main`
	]);
	const rows = raw ? raw.split('\n') : [];

	const layouts = new Map<string, Layout>();
	const layoutAt = (revision: string) => {
		const layout = layouts.get(revision) ?? layoutOf(revision, root);
		layouts.set(revision, layout);
		return layout;
	};
	const commits = rows.map((line) => {
		const [sha = '', fullSha = '', author = '', subject = ''] = line.split('\t');
		const records = changeRecords(
			gitOutput(
				['show', '-z', '--name-status', '--format=', '--diff-merges=first-parent', sha],
				true
			)
		);
		const sideLayouts = { parent: layoutAt(`${fullSha}^1`), commit: layoutAt(fullSha) };
		const sides = records.flatMap((record) => changeSides(record, sideLayouts));
		const { priority, type } = classify(subject, author);
		return {
			sha,
			author,
			subject,
			type,
			priority,
			files: records.length,
			categories: categoriesFor(sides),
			alreadyExcluded: isExcluded(fullSha, excluded),
			...(isOmittedOnly(sides, omitted) && { omittedOnly: true })
		};
	});

	let view = commits;
	if (values.type) view = view.filter((c) => c.type === values.type);
	if (values.tag) view = view.filter((c) => c.priority === values.tag || c.type === values.tag);

	if (values.json) {
		console.log(JSON.stringify({ base, count: view.length, commits: view }, null, 2));
		return;
	}

	const byPriority: Record<string, number> = {};
	for (const c of commits) byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;

	console.log('');
	console.log(
		`Upstream commits to review (oldest first = integration order), since ${base.slice(0, 8)}:`
	);
	console.log(
		`Total ${commits.length}  ·  ` +
			Object.entries(byPriority)
				.map(([k, v]) => `${k}:${v}`)
				.join('  ')
	);
	console.log(
		'Review EVERY commit by reading its diff: integrate, mark already-present, or exclude with a reason.'
	);
	console.log(
		'Tags/categories are hints only (ordering + how much adaptation), never a gate: do not skip, integrate, or exclude a commit from its label.'
	);
	console.log('');
	for (const c of view) {
		const tag = c.priority === 'security' ? '🔒security' : c.priority;
		const cats = c.categories.length ? ` [${c.categories.join(',')}]` : '';
		const ex = `${c.omittedOnly ? ' (omitted-only)' : ''}${c.alreadyExcluded ? ' (already excluded)' : ''}`;
		console.log(
			`${c.sha}  ${tag.padEnd(10)} ${String(c.files).padStart(3)}f${cats}  ${c.subject}${ex}`
		);
	}
	console.log('');
	console.log(
		'A category flags a fork-divergence area to adapt carefully. A commit with NO category'
	);
	console.log('still gets its diff read and a verdict; never blind-apply an untagged one.');
	console.log('Oversized commit? Triage within it by file/hunk, not by pre-squash branch commits.');
}

// Only run when invoked directly, so importing this module (e.g. from tests) does
// not trigger the git fetch / network side effects in main().
if (import.meta.main) main();
