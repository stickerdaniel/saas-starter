#!/usr/bin/env bun
/**
 * list-upstream-changes.ts — list upstream commits to review for this fork.
 *
 * Lists every upstream commit since the last sync (or the fork point) so EACH can
 * be reviewed, understood, and consciously integrated or excluded. This is not a
 * security-only tool: all enhancements are candidates. Each commit gets a priority
 * tag (security highest) and the divergence categories it touches, but nothing is
 * filtered out by default — comprehensive review is the goal.
 *
 * Unit of review = the squashed first-parent commit on upstream's default branch.
 * Upstream squash-merges PRs, so each commit is the canonical, net, reviewed unit
 * of "what landed"; do NOT drop to pre-squash branch commits (intra-PR churn, worse
 * signal). For an oversized commit, triage WITHIN it by file/hunk.
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

const MARKER = '.upstream-sync.json';
const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];
function gitEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const k of SCRUBBED) delete env[k];
	return env;
}
function git(args: string[], allowFail = false): string {
	try {
		return execFileSync('git', args, {
			encoding: 'utf-8',
			env: gitEnv(),
			maxBuffer: 64 * 1024 * 1024
		}).trim();
	} catch (err) {
		if (allowFail) return '';
		throw err;
	}
}

// Divergence categories: which fork-divergence area a changed path belongs to.
// Generic shapes, not fork specifics — used to flag commits that need adaptation.
const CATEGORY_RULES: Array<[string, RegExp]> = [
	['i18n', /^src\/i18n\/|\bmessages?\/|\.ftl$/],
	['theme', /layout\.css$|app\.css$|tailwind|theme|design-?tokens|design-?system/i],
	[
		'env/deploy',
		/^\.env|wrangler|vercel|fly\.|dockerfile|^scripts\/deploy|convex\.config|\.github\/workflows\//i
	],
	['branding', /legal|brand|marketing|logo|seo|manifest|favicon/i],
	['backend', /^src\/lib\/convex\/|^convex\//],
	['tests', /(^|\/)e2e\/|\.test\.|\.spec\./],
	[
		'config',
		/package\.json$|tsconfig|eslint|oxlint|\.prettier|knip|components\.json$|svelte\.config/i
	]
];
export function categoriesFor(files: string[]): string[] {
	const hit = new Set<string>();
	for (const f of files) for (const [cat, re] of CATEGORY_RULES) if (re.test(f)) hit.add(cat);
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
	const type = m ? m[1].toLowerCase() : 'other';
	const isBot = /(renovate|dependabot)\[bot\]/i.test(author);
	// Bot dependency bumps are routine chores even when typed fix(deps); only a real
	// security signal lifts them above chore.
	const priority = security ? 'security' : isBot ? 'chore' : type === 'fix' ? 'fix' : type;
	return { priority, type };
}

function main() {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			json: { type: 'boolean', default: false },
			type: { type: 'string' },
			tag: { type: 'string' }
		},
		strict: false
	});

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
		console.error('No marker yet — deriving fork point via find-fork-point.ts ...');
		const out = execFileSync('bun', [join(import.meta.dir, 'find-fork-point.ts'), '--json'], {
			encoding: 'utf-8',
			env: gitEnv(),
			maxBuffer: 16 * 1024 * 1024
		});
		base = JSON.parse(out).forkPoint;
	}
	git(['fetch', '--quiet', 'upstream'], true);

	const excluded = new Set(((marker?.excluded as Array<{ sha?: string }>) || []).map((e) => e.sha));

	// Oldest-first first-parent squash commits since base; %x09 = tab field sep.
	const raw = git([
		'log',
		'--no-merges',
		'--first-parent',
		'--reverse',
		'--format=%h%x09%an%x09%s',
		`${base}..upstream/main`
	]);
	const rows = raw ? raw.split('\n') : [];

	const commits = rows.map((line) => {
		const [sha, author, subject] = line.split('\t');
		const files = git(['show', '--name-only', '--format=', sha], true).split('\n').filter(Boolean);
		const { priority, type } = classify(subject, author);
		return {
			sha,
			author,
			subject,
			type,
			priority,
			files: files.length,
			categories: categoriesFor(files),
			alreadyExcluded: excluded.has(sha)
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
		'Review EVERY commit by reading its diff — integrate, mark already-present, or exclude with a reason.'
	);
	console.log(
		'Tags/categories are hints only (ordering + how much adaptation), never a gate: do not skip, integrate, or exclude a commit from its label.'
	);
	console.log('');
	for (const c of view) {
		const tag = c.priority === 'security' ? '🔒security' : c.priority;
		const cats = c.categories.length ? ` [${c.categories.join(',')}]` : '';
		const ex = c.alreadyExcluded ? ' (already excluded)' : '';
		console.log(
			`${c.sha}  ${tag.padEnd(10)} ${String(c.files).padStart(3)}f${cats}  ${c.subject}${ex}`
		);
	}
	console.log('');
	console.log(
		'A category flags a fork-divergence area to adapt carefully. NO category is not a free pass —'
	);
	console.log(
		'still read the diff and give that commit a verdict; never blind-apply an untagged one.'
	);
	console.log('Oversized commit? Triage within it by file/hunk, not by pre-squash branch commits.');
}

// Only run when invoked directly, so importing this module (e.g. from tests) does
// not trigger the git fetch / network side effects in main().
if (import.meta.main) main();
