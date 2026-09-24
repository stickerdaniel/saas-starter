/**
 * Interim shadcn/lint baseline gate.
 *
 * The shadcn policy (eslint/shadcn-policy.js) is not enforced by the application ESLint
 * config yet, because the existing source still carries findings that the migration
 * removes over time. Until enforcement lands, this gate stops NEW findings: every
 * finding in the current tree must already exist in the baseline committed on the
 * protected base commit. It is a ratchet, not production enforcement.
 *
 * Usage:
 *   bun scripts/shadcn-baseline.ts               Check against the protected base
 *   bun scripts/shadcn-baseline.ts --base <rev>  Check against an explicit commit
 *   bun scripts/shadcn-baseline.ts --write       Rewrite eslint/shadcn-baseline.json, then check
 *
 * The protected base is SHADCN_BASELINE_BASE (CI passes the pull request base or the
 * pre-push SHA), else `--base`, else the merge base with origin/main or main. The
 * baseline is read from that commit, so editing the committed file cannot accept a new
 * finding. When there is no such baseline (a base without the file, or the all-zero SHA
 * GitHub sends for a push that creates a branch or repository), the committed file is the
 * bootstrap allowance, indexed by current paths, and needs review as a whole.
 *
 * Coverage is proven by the scan, not recorded: every tracked source file under src/ is
 * either linted with all policy rules active or ignored by eslint.config.js, and a file
 * ignored now but not on the base fails. A new or renamed clean file therefore passes
 * as is. A newly uncovered source file, a fatal parse, a probe that misses a rule, or
 * any warning from the plugin (missing theme, Tailwind worker fallback) fails.
 *
 * The committed file records only files with findings, the ignored files, and the
 * policy and scan-config hashes; it must match the tree exactly, so the ratchet
 * tightens as findings are fixed. Reviewed route for fixes, renames of files with
 * findings, and policy or scan-config edits: make the change, run `--write`, and commit
 * the regenerated baseline with it. The check still proves that every finding existed
 * on the base, following renames Git detects (at least 50% similarity; rename first,
 * edit later), so a policy edit can only remove findings, which its diff shows, and
 * removing a rule from the policy fails. The lint engine hash is diagnostic only, so a
 * dependency update that adds no finding passes untouched.
 *
 * Finding identity is file, rule and the message subject: the first clause of the
 * message, which names the offending class, property or component. Line numbers and
 * the advice after the subject are not part of it, so moved code and a new Button
 * variant keep existing findings matched, while a different finding with the same
 * rule count does not.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { ESLint } from 'eslint';
import * as prettier from 'prettier';
import safeSvelteParser from '../eslint/parsers/safe-svelte-parser.js';
import { shadcnPolicy, shadcnSourceExtensions } from '../eslint/shadcn-policy.js';
import { isolatedGitEnv } from './git-context';
import { runCommand } from './process/command-runner';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const BASELINE_PATH = 'eslint/shadcn-baseline.json';
export const SCAN_CONFIG_PATH = 'eslint/shadcn-baseline.config.js';
export const POLICY_PATH = 'eslint/shadcn-policy.js';
const SCHEMA = 1;
const RULE_PREFIX = 'shadcn/';
const WRITE_COMMAND = 'bun scripts/shadcn-baseline.ts --write';

/**
 * Tracked files under src/ that the policy must cover, from the policy's own extension
 * list. The scan still fails closed on any of them without all policy rules active.
 */
export const WATCHED_SOURCE = new RegExp(`^src/.*\\.(?:${shadcnSourceExtensions.join('|')})$`);

/**
 * Lockfile roots whose resolved dependency closure can change what the scan reports:
 * the linter, the parsers and compilers it runs, the plugin, and the Tailwind build
 * that the plugin reads the project theme through.
 */
const ENGINE_ROOTS = [
	'@shadcn/lint',
	'@tailwindcss/typography',
	'eslint',
	'eslint-plugin-svelte',
	'svelte',
	'svelte-eslint-parser',
	'tailwindcss',
	'tw-animate-css',
	'typescript',
	'typescript-eslint'
];

/** A path under src/ that every SvelteKit app has; the probe lints text as if it lived there. */
export const PROBE_PATH = 'src/routes/+layout.svelte';
export const PROBE_SOURCE = `<script lang="ts">
import { Button } from '$lib/components/ui/button';
import { tv } from 'tailwind-variants';
const style = tv({ base: 'bg-red-500' });
function getClasses(): string { return style(); }
</script>
<Button class="rounded-full">Save</Button>
<Button class={getClasses()}>Save</Button>
<div style="color: red" class="w-[550px] hovr:flex"></div>
`;

export interface Identity {
	/** eslint/shadcn-policy.js, line endings normalized. */
	policy: string;
	/** eslint/shadcn-baseline.config.js, line endings normalized. */
	config: string;
	/** Root specifiers and resolved lock entries of the lint engine closure; diagnostic only. */
	engine: string;
}

export interface Baseline {
	schema: number;
	note: string;
	identity: Identity;
	rules: string[];
	ignored: string[];
	/** Covered files that have findings, as rule (without prefix) to sorted digests. */
	files: Record<string, Record<string, string[]>>;
}

export interface Finding {
	file: string;
	rule: string;
	digest: string;
	line: number;
	column: number;
	message: string;
}

export interface Snapshot {
	identity: Identity;
	rules: string[];
	included: string[];
	ignored: string[];
	findings: Finding[];
}

interface ScanReport {
	included: string[];
	ignored: string[];
	problems: string[];
	findings: Finding[];
}

export interface Verdict {
	/** Cannot be accepted by regenerating the baseline. */
	blocking: string[];
	/** The committed baseline disagrees with the tree; regenerate it. */
	stale: string[];
	notes: string[];
}

// -- Pure helpers ----------------------------------------------------------------------

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function normalizeEol(text: string): string {
	return text.replace(/\r\n?/g, '\n');
}

function toPosix(file: string): string {
	return file.split(path.sep).join('/');
}

/**
 * The first clause of a finding message, cut at the first `:` or `.` followed by
 * whitespace outside double quotes. It names the offending class, property or
 * component; the advice after it lists variants, sizes and theme tokens, which change
 * whenever a component or the theme gains one.
 */
export function findingSubject(message: string): string {
	let quoted = false;
	let end = message.length;
	for (let index = 0; index < message.length; index++) {
		const char = message[index];
		if (char === '"') quoted = !quoted;
		else if (!quoted && (char === ':' || char === '.') && /\s/.test(message[index + 1] ?? ' ')) {
			end = index;
			break;
		}
	}
	// Messages name component files with path.relative, which uses backslashes on Windows.
	return message.slice(0, end).replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}

export function findingDigest(message: string): string {
	return sha256(findingSubject(message)).slice(0, 12);
}

function shortRule(rule: string): string {
	return rule.startsWith(RULE_PREFIX) ? rule.slice(RULE_PREFIX.length) : rule;
}

export function policyRuleIds(): string[] {
	return Object.keys(shadcnPolicy.rules).sort();
}

export function toBaseline(snapshot: Snapshot): Baseline {
	const files: Baseline['files'] = {};
	const covered = new Set(snapshot.included);
	for (const finding of snapshot.findings) {
		if (!covered.has(finding.file)) {
			throw new Error(`Finding outside the covered files: ${finding.file}`);
		}
		(((files[finding.file] ??= {})[shortRule(finding.rule)] ??= []) as string[]).push(
			finding.digest
		);
	}
	for (const entry of Object.values(files)) {
		for (const rule of Object.keys(entry)) entry[rule]!.sort();
	}
	return {
		schema: SCHEMA,
		note: `Interim shadcn/lint ratchet, not enforcement. Generated by \`${WRITE_COMMAND}\`; CI compares findings with this file on the protected base commit.`,
		identity: snapshot.identity,
		rules: [...snapshot.rules].sort(),
		ignored: [...snapshot.ignored].sort(),
		files: Object.fromEntries(
			Object.keys(files)
				.sort()
				.map((file) => [
					file,
					Object.fromEntries(
						Object.keys(files[file]!)
							.sort()
							.map((rule) => [rule, files[file]![rule]!])
					)
				])
		)
	};
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseBaseline(text: string, label: string): Baseline {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${(error as Error).message}`, { cause: error });
	}
	const baseline = value as Partial<Baseline>;
	const identity = baseline.identity as Partial<Identity> | undefined;
	const valid =
		baseline.schema === SCHEMA &&
		typeof baseline.note === 'string' &&
		!!identity &&
		typeof identity.policy === 'string' &&
		typeof identity.config === 'string' &&
		typeof identity.engine === 'string' &&
		isStringArray(baseline.rules) &&
		isStringArray(baseline.ignored) &&
		!!baseline.files &&
		typeof baseline.files === 'object' &&
		Object.values(baseline.files).every(
			(entry) =>
				!!entry &&
				typeof entry === 'object' &&
				Object.values(entry).every((digests) => isStringArray(digests))
		);
	if (!valid) throw new Error(`${label} does not match baseline schema ${SCHEMA}.`);
	return baseline as Baseline;
}

function allowanceKey(file: string, rule: string, digest: string): string {
	return `${file}\0${shortRule(rule)}\0${digest}`;
}

function countBaseline(baseline: Baseline): Map<string, number> {
	const counts = new Map<string, number>();
	for (const [file, entry] of Object.entries(baseline.files)) {
		for (const [rule, digests] of Object.entries(entry)) {
			for (const digest of digests) {
				const key = allowanceKey(file, rule, digest);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}
	return counts;
}

function findingCount(baseline: Baseline): number {
	return Object.values(baseline.files).reduce(
		(total, entry) =>
			total + Object.values(entry).reduce((sum, digests) => sum + digests.length, 0),
		0
	);
}

function formatFinding(finding: Finding): string {
	return `${finding.file}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`;
}

function setDifference(left: Iterable<string>, right: Iterable<string>): string[] {
	const exclude = new Set(right);
	return [...new Set(left)].filter((item) => !exclude.has(item)).sort();
}

function listed(items: string[], limit = 20): string {
	const shown = items.slice(0, limit).map((item) => `\n    ${item}`);
	return shown.join('') + (items.length > limit ? `\n    ... ${items.length - limit} more` : '');
}

/**
 * Decide the gate from the current scan, the committed baseline, and the baseline on
 * the protected base. `renames` maps a current path to its path on the protected base.
 */
export function evaluate(input: {
	current: Snapshot;
	head: Baseline;
	protectedBaseline: Baseline;
	protectedLabel: string;
	renames: ReadonlyMap<string, string>;
}): Verdict {
	const { current, head, protectedBaseline, protectedLabel, renames } = input;
	const blocking: string[] = [];
	const stale: string[] = [];
	const notes: string[] = [];

	// A policy or scan-config change is reviewed as a diff together with the regenerated
	// baseline. It cannot add a finding (the multiset check below still applies), a
	// switched-off rule leaves the probe silent, and removing a rule changes the rule set.
	for (const [field, file] of [
		['policy', POLICY_PATH],
		['config', SCAN_CONFIG_PATH]
	] as const) {
		if (current.identity[field] !== protectedBaseline.identity[field]) {
			notes.push(`${file} differs from ${protectedLabel}; findings were still compared.`);
		}
	}
	if (!isDeepStrictEqual([...current.rules].sort(), [...protectedBaseline.rules].sort())) {
		blocking.push(
			`The policy rule set changed from the baseline on ${protectedLabel}:` +
				listed([
					`now: ${[...current.rules].sort().join(', ')}`,
					`base: ${[...protectedBaseline.rules].sort().join(', ')}`
				])
		);
	}

	const newlyIgnored = setDifference(current.ignored, protectedBaseline.ignored);
	if (newlyIgnored.length > 0) {
		blocking.push(
			`Tracked source files are ignored by ESLint but were not ignored on ${protectedLabel}; ` +
				`an ignore must not remove files from the shadcn scan:${listed(newlyIgnored)}`
		);
	}

	const allowance = countBaseline(protectedBaseline);
	const groups = new Map<string, Finding[]>();
	for (const finding of current.findings) {
		const file = renames.get(finding.file) ?? finding.file;
		const key = allowanceKey(file, finding.rule, finding.digest);
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}
	const added: string[] = [];
	for (const [key, findings] of groups) {
		const allowed = allowance.get(key) ?? 0;
		if (findings.length <= allowed) continue;
		for (const finding of findings) {
			added.push(`${formatFinding(finding)} (${findings.length} now, ${allowed} on base)`);
		}
	}
	if (added.length > 0) {
		blocking.push(
			`New shadcn/lint findings relative to ${protectedLabel}. Fix them; rewriting ` +
				`${BASELINE_PATH} cannot accept them because CI reads the baseline from the base commit:` +
				listed(added.sort(), 50)
		);
	}

	// Diagnostic only: a dependency update that adds no finding must pass untouched.
	if (
		current.identity.engine !== protectedBaseline.identity.engine ||
		current.identity.engine !== head.identity.engine
	) {
		notes.push(
			`The lint engine dependencies differ from the recorded ones; findings were still compared.`
		);
	}

	// The committed file must record this tree's findings, policy and ignores exactly, so
	// fixes tighten the ratchet. Covered files without findings are not recorded: the scan
	// proves their coverage, so a new or renamed clean file needs no regeneration.
	const expected = toBaseline(current);
	for (const field of ['policy', 'config'] as const) {
		if (head.identity[field] !== expected.identity[field]) {
			stale.push(`identity.${field} does not match the current ${field} file.`);
		}
	}
	if (!isDeepStrictEqual(head.rules, expected.rules)) stale.push('rules differ from the policy.');
	const ignoredAdded = setDifference(expected.ignored, head.ignored);
	const ignoredRemoved = setDifference(head.ignored, expected.ignored);
	if (ignoredAdded.length || ignoredRemoved.length) {
		stale.push(
			'The ignored source set differs:' +
				listed([...ignoredAdded.map((f) => `+ ${f}`), ...ignoredRemoved.map((f) => `- ${f}`)])
		);
	}
	const findingDrift = [...new Set([...Object.keys(head.files), ...Object.keys(expected.files)])]
		.filter((file) => !isDeepStrictEqual(head.files[file], expected.files[file]))
		.sort();
	if (findingDrift.length > 0) {
		stale.push(`Recorded findings differ for:${listed(findingDrift)}`);
	}
	return { blocking, stale, notes };
}

// -- Identity ------------------------------------------------------------------------------

type LockEntry = unknown[];
interface Lockfile {
	workspaces: Record<string, Record<string, Record<string, string> | undefined>>;
	packages: Record<string, LockEntry>;
}

/** bun.lock is JSON with trailing commas; drop the commas that sit outside strings. */
export function parseLockfile(text: string): Lockfile {
	let output = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (quoted) {
			output += char;
			if (char === '\\') output += text[++index] ?? '';
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		if (char === ',') {
			let next = index + 1;
			while (/\s/.test(text[next] ?? '')) next++;
			if (text[next] === ']' || text[next] === '}') continue;
		}
		output += char;
	}
	return JSON.parse(output) as Lockfile;
}

/** Split a bun.lock package key such as `a/@scope/b` into its package names. */
function lockKeyNames(key: string): string[] {
	const parts = key.split('/');
	const names: string[] = [];
	for (let index = 0; index < parts.length; index++) {
		names.push(parts[index]!.startsWith('@') ? `${parts[index]}/${parts[++index]}` : parts[index]!);
	}
	return names;
}

/** Node-style lookup: nested under the dependent first, then each ancestor, then the top. */
function resolveLockKey(packages: Lockfile['packages'], from: string, name: string) {
	const names = lockKeyNames(from);
	for (let depth = names.length; depth > 0; depth--) {
		const candidate = `${names.slice(0, depth).join('/')}/${name}`;
		if (packages[candidate]) return candidate;
	}
	return packages[name] ? name : undefined;
}

export function engineIdentity(lockText: string): string {
	const lock = parseLockfile(lockText);
	const root = lock.workspaces[''] ?? {};
	const lines: string[] = [];
	for (const name of ENGINE_ROOTS) {
		const specifier =
			root.dependencies?.[name] ??
			root.devDependencies?.[name] ??
			root.optionalDependencies?.[name];
		if (!specifier || !lock.packages[name]) {
			throw new Error(`bun.lock does not resolve the lint engine root ${name}.`);
		}
		lines.push(`root ${name} ${specifier}`);
	}
	const seen = new Set<string>();
	const queue = [...ENGINE_ROOTS];
	while (queue.length > 0) {
		const key = queue.pop()!;
		if (seen.has(key)) continue;
		seen.add(key);
		const metadata = (lock.packages[key]!.find(
			(item) => !!item && typeof item === 'object' && !Array.isArray(item)
		) ?? {}) as Record<string, Record<string, string> | undefined>;
		for (const name of Object.keys({
			...metadata.dependencies,
			...metadata.optionalDependencies,
			...metadata.peerDependencies
		})) {
			// Optional peers that nothing installed have no entry and cannot affect the scan.
			const resolved = resolveLockKey(lock.packages, key, name);
			if (resolved) queue.push(resolved);
		}
	}
	for (const key of [...seen].sort()) lines.push(`${key} ${JSON.stringify(lock.packages[key])}`);
	return sha256(lines.join('\n'));
}

export function currentIdentity(root = REPO_ROOT): Identity {
	const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
	return {
		policy: sha256(normalizeEol(read(POLICY_PATH))),
		config: sha256(normalizeEol(read(SCAN_CONFIG_PATH))),
		engine: engineIdentity(read('bun.lock'))
	};
}

// -- Git -------------------------------------------------------------------------------------

function git(args: string[], root = REPO_ROOT): string {
	return execFileSync('git', ['-c', `safe.directory=${realpathSync(root)}`, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: isolatedGitEnv(),
		maxBuffer: 64 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function gitSucceeds(args: string[], root = REPO_ROOT): boolean {
	try {
		git(args, root);
		return true;
	} catch {
		return false;
	}
}

function trackedSources(root: string): string[] {
	return git(['ls-files', '-z', '--', 'src'], root)
		.split('\0')
		.filter((file) => WATCHED_SOURCE.test(file))
		.sort();
}

/** Renames Git detects between the base commit and the working tree, current path to base path. */
export function parseRenames(nameStatus: string): Map<string, string> {
	const renames = new Map<string, string>();
	const fields = nameStatus.split('\0');
	for (let index = 0; index < fields.length - 1;) {
		const status = fields[index++]!;
		const from = fields[index++]!;
		if (status.startsWith('R') || status.startsWith('C')) {
			const to = fields[index++]!;
			if (status.startsWith('R')) renames.set(to, from);
		}
	}
	return renames;
}

export interface ProtectedBase {
	commit?: string;
	label: string;
	baseline?: Baseline;
	bootstrap?: string;
}

/**
 * The allowance the current findings are compared against, and how paths map onto it.
 * Renames translate current paths to base paths, so they apply only to a baseline read
 * from the base commit; the bootstrap allowance is the head baseline, already indexed by
 * current paths.
 */
export function comparisonBase(
	base: ProtectedBase,
	head: Baseline,
	readRenames: (commit: string) => Map<string, string>
): { protectedBaseline: Baseline; protectedLabel: string; renames: Map<string, string> } {
	if (!base.baseline || !base.commit) {
		return { protectedBaseline: head, protectedLabel: BASELINE_PATH, renames: new Map() };
	}
	return {
		protectedBaseline: base.baseline,
		protectedLabel: base.label,
		renames: readRenames(base.commit)
	};
}

export function resolveProtectedBase(
	explicit: string | undefined,
	env: NodeJS.ProcessEnv = process.env
): ProtectedBase {
	const inCi = env.GITHUB_ACTIONS === 'true';
	const requested = env.SHADCN_BASELINE_BASE?.trim() || explicit?.trim();
	let commit: string | undefined;
	if (requested) {
		// GitHub sends the all-zero SHA as `before` on the push that creates a branch or a new
		// repository from the template; there is no protected commit to read.
		if (/^0+$/.test(requested)) {
			return {
				label: BASELINE_PATH,
				bootstrap: `The protected base is the all-zero SHA (a push that created the branch); the committed ${BASELINE_PATH} is the bootstrap baseline and needs review as a whole.`
			};
		}
		try {
			commit = git(['rev-parse', '--verify', `${requested}^{commit}`]).trim();
		} catch {
			throw new Error(`The protected base ${requested} is not a commit in this checkout.`);
		}
	} else {
		for (const candidate of ['origin/main', 'main']) {
			if (!gitSucceeds(['rev-parse', '--verify', `${candidate}^{commit}`])) continue;
			commit = git(['merge-base', candidate, 'HEAD']).trim();
			break;
		}
		if (!commit) {
			if (inCi) throw new Error('CI must pass SHADCN_BASELINE_BASE; no trunk ref is available.');
			return {
				label: 'the working tree',
				bootstrap: 'No trunk ref found; comparing with the working-tree baseline only.'
			};
		}
	}
	if (!gitSucceeds(['merge-base', '--is-ancestor', commit, 'HEAD'])) {
		throw new Error(`The protected base ${commit} is not an ancestor of HEAD.`);
	}
	const label = `base ${commit.slice(0, 12)}`;
	if (!gitSucceeds(['cat-file', '-e', `${commit}:${BASELINE_PATH}`])) {
		return {
			commit,
			label,
			bootstrap: `${label} has no ${BASELINE_PATH}; the committed file is the bootstrap baseline and needs review as a whole.`
		};
	}
	return {
		commit,
		label,
		baseline: parseBaseline(
			git(['show', `${commit}:${BASELINE_PATH}`]),
			`${BASELINE_PATH} on ${label}`
		)
	};
}

// -- Scan (child process) ------------------------------------------------------------------

function expectedRuleEntry(value: unknown): unknown[] {
	const [severity, ...options] = Array.isArray(value) ? value : [value];
	const numeric =
		severity === 'error' ? 2 : severity === 'warn' ? 1 : severity === 'off' ? 0 : severity;
	return [numeric, ...options];
}

/**
 * Configuration problems for one covered file: every policy rule must be active with the
 * policy's own options, and Svelte files must use the safe Svelte parser.
 */
export function coverageProblems(
	file: string,
	config: { rules?: Record<string, unknown>; languageOptions?: { parser?: unknown } } | undefined
): string[] {
	if (!config) return [`${file}: no ESLint configuration applies, so the shadcn policy does not.`];
	const problems: string[] = [];
	for (const [rule, value] of Object.entries(shadcnPolicy.rules)) {
		if (!isDeepStrictEqual(config.rules?.[rule], expectedRuleEntry(value))) {
			problems.push(`${file}: ${rule} is not active with the policy options.`);
		}
	}
	if (file.endsWith('.svelte') && config.languageOptions?.parser !== safeSvelteParser) {
		problems.push(`${file}: Svelte files must be parsed by eslint/parsers/safe-svelte-parser.js.`);
	}
	return problems;
}

export function createScanner(root = REPO_ROOT): ESLint {
	return new ESLint({
		cwd: root,
		overrideConfigFile: path.join(root, SCAN_CONFIG_PATH),
		cache: false,
		// An inline disable must not hide a new finding from a ratchet.
		allowInlineConfig: false
	});
}

async function scan(root: string): Promise<ScanReport> {
	const problems: string[] = [];
	const rules = policyRuleIds();
	if (!existsSync(path.join(root, '.svelte-kit', 'tsconfig.json'))) {
		problems.push(
			'Run `bun svelte-kit sync` first: the $lib alias the plugin resolves lives there.'
		);
	}
	const scanner = createScanner(root);
	const application = new ESLint({ cwd: root, cache: false });

	const included: string[] = [];
	const ignored: string[] = [];
	for (const file of trackedSources(root)) {
		const absolute = path.join(root, file);
		const scanIgnored = await scanner.isPathIgnored(absolute);
		if (scanIgnored !== (await application.isPathIgnored(absolute))) {
			problems.push(`${file}: the scan config and eslint.config.js disagree on ignoring it.`);
		}
		(scanIgnored ? ignored : included).push(file);
	}
	for (const file of included) {
		problems.push(
			...coverageProblems(file, await scanner.calculateConfigForFile(path.join(root, file)))
		);
	}

	if (!included.includes(PROBE_PATH)) problems.push(`${PROBE_PATH} is not covered by the scan.`);
	const [probe] = await scanner.lintText(PROBE_SOURCE, { filePath: path.join(root, PROBE_PATH) });
	const probeRules = new Set(probe?.messages.map((message) => message.ruleId));
	const silent = rules.filter((rule) => !probeRules.has(rule));
	if (!probe || probe.fatalErrorCount > 0 || silent.length > 0) {
		problems.push(`The probe did not trigger every policy rule; silent: ${silent.join(', ')}.`);
	}

	const findings: Finding[] = [];
	const results = await scanner.lintFiles(included.map((file) => path.join(root, file)));
	const scanned = results.map((result) => toPosix(path.relative(root, result.filePath)));
	for (const file of setDifference(included, scanned)) problems.push(`${file}: not linted.`);
	for (const file of setDifference(scanned, included))
		problems.push(`${file}: linted unexpectedly.`);
	for (const [index, result] of results.entries()) {
		const file = scanned[index]!;
		if (result.suppressedMessages.length > 0) {
			problems.push(`${file}: ${result.suppressedMessages.length} suppressed message(s).`);
		}
		for (const message of result.messages) {
			if (
				message.fatal ||
				!message.ruleId ||
				!rules.includes(message.ruleId) ||
				message.severity !== 2
			) {
				problems.push(
					`${file}:${message.line}:${message.column} unexpected diagnostic ` +
						`${message.ruleId ?? '(fatal)'}: ${message.message}`
				);
				continue;
			}
			findings.push({
				file,
				rule: message.ruleId,
				digest: findingDigest(message.message),
				line: message.line,
				column: message.column,
				message: message.message
			});
		}
	}
	return { included, ignored, problems, findings };
}

/**
 * The scan runs in a child so that anything the plugin writes to stderr, including the
 * Tailwind worker thread, is caught: missing-theme and fallback warnings do not change
 * the exit code, and a scan that degraded silently would pass as shrinkage.
 */
async function runScan(root: string): Promise<Snapshot & { problems: string[] }> {
	const result = await runCommand({
		command: process.execPath,
		args: [path.join(root, 'scripts', 'shadcn-baseline.ts'), '--scan'],
		cwd: root,
		output: 'capture',
		timeoutMs: 15 * 60 * 1000
	});
	if (!result.ok) throw new Error(`The scan failed: ${result.diagnostic}`);
	const problems: string[] = [];
	const stderr = result.stderr.trim();
	if (stderr) problems.push(`The scan wrote to stderr (plugin or parser warning):\n${stderr}`);
	const report = JSON.parse(result.stdout) as ScanReport;
	problems.push(...report.problems);
	return {
		identity: currentIdentity(root),
		rules: policyRuleIds(),
		included: report.included,
		ignored: report.ignored,
		findings: report.findings,
		problems
	};
}

// -- Main ----------------------------------------------------------------------------------

async function formatBaseline(baseline: Baseline, root: string): Promise<string> {
	const file = path.join(root, BASELINE_PATH);
	const options = (await prettier.resolveConfig(file)) ?? {};
	return prettier.format(JSON.stringify(baseline), { ...options, filepath: file });
}

function summarize(snapshot: Snapshot): string {
	const counts = new Map<string, number>();
	for (const finding of snapshot.findings) {
		counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
	}
	const byRule = [...counts].sort(([a], [b]) => a.localeCompare(b));
	return (
		`${snapshot.included.length} covered files, ${snapshot.ignored.length} ignored, ` +
		`${snapshot.findings.length} existing findings` +
		(byRule.length ? ` (${byRule.map(([rule, count]) => `${rule} ${count}`).join(', ')})` : '')
	);
}

async function main(): Promise<number> {
	const { values } = parseArgs({
		options: {
			scan: { type: 'boolean' },
			write: { type: 'boolean' },
			base: { type: 'string' }
		},
		strict: true
	});
	if (values.scan) {
		await Bun.write(Bun.stdout, JSON.stringify(await scan(REPO_ROOT)));
		return 0;
	}

	const started = performance.now();
	const protectedBase = resolveProtectedBase(values.base);
	const current = await runScan(REPO_ROOT);
	if (current.problems.length > 0) {
		console.error('shadcn baseline: the scan is not trustworthy, so no findings were compared.');
		for (const problem of current.problems) console.error(`  ${problem}`);
		return 1;
	}

	const baselineFile = path.join(REPO_ROOT, BASELINE_PATH);
	let head: Baseline;
	if (values.write) {
		head = toBaseline(current);
		writeFileSync(baselineFile, await formatBaseline(head, REPO_ROOT));
		console.log(`shadcn baseline: wrote ${BASELINE_PATH} (${findingCount(head)} findings).`);
	} else {
		if (!existsSync(baselineFile)) {
			console.error(`shadcn baseline: ${BASELINE_PATH} is missing; run \`${WRITE_COMMAND}\`.`);
			return 1;
		}
		head = parseBaseline(readFileSync(baselineFile, 'utf8'), BASELINE_PATH);
	}

	if (protectedBase.bootstrap) console.log(`shadcn baseline: ${protectedBase.bootstrap}`);
	const verdict = evaluate({
		current,
		head,
		...comparisonBase(protectedBase, head, (commit) =>
			parseRenames(git(['diff', '-z', '--name-status', '-M', commit, '--', 'src']))
		)
	});
	for (const note of verdict.notes) console.log(`shadcn baseline: ${note}`);
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	if (verdict.blocking.length > 0) {
		console.error('shadcn baseline: FAILED');
		for (const problem of verdict.blocking) console.error(`  ${problem}`);
		if (values.write) console.error(`  ${BASELINE_PATH} was written, but CI will reject it.`);
		return 1;
	}
	if (verdict.stale.length > 0) {
		console.error(`shadcn baseline: ${BASELINE_PATH} does not match the tree.`);
		for (const problem of verdict.stale) console.error(`  ${problem}`);
		console.error(`  Run \`${WRITE_COMMAND}\` and commit the result with this change.`);
		return 1;
	}
	console.log(
		`shadcn baseline: passed in ${seconds}s against ${protectedBase.label}; ${summarize(current)}. ` +
			'Interim ratchet only: no new findings, not full enforcement.'
	);
	return 0;
}

if (import.meta.main) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error: Error) => {
			console.error(`shadcn baseline: ${error.message}`);
			process.exitCode = 1;
		}
	);
}
