import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizedGitEnv, stagedGitEnv } from '../git-context';
import {
	evaluateKnowledgePolicy,
	matchesKnowledgeCandidate,
	type KnowledgePolicyConfig,
	type PolicyFinding,
	type PolicyRepository
} from './policy';

export type KnowledgePolicyScope =
	{ kind: 'full' } | { kind: 'files'; files: readonly string[] } | { kind: 'staged' };

export interface PolicyRunResult {
	findings: readonly PolicyFinding[];
	filesEvaluated: number;
	scope: KnowledgePolicyScope['kind'];
	escalatedFromFiles: boolean;
}

interface IndexEntry {
	mode: string;
	oid: string;
	stage: number;
	file: string;
}

function git(
	root: string,
	args: string[],
	input?: Buffer | string,
	env: NodeJS.ProcessEnv = sanitizedGitEnv()
) {
	const result = spawnSync('git', args, {
		cwd: root,
		encoding: input === undefined ? 'utf8' : undefined,
		input,
		env,
		maxBuffer: 128 * 1024 * 1024
	});
	if (result.status !== 0) {
		const stderr = Buffer.isBuffer(result.stderr)
			? result.stderr.toString('utf8')
			: (result.stderr ?? '');
		throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
	}
	return result;
}

function toPosix(file: string): string {
	return file.split(path.sep).join('/');
}

function isInsideRoot(root: string, file: string): boolean {
	const relative = path.relative(root, file);
	return (
		relative === '' ||
		(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
}

function pathEntryExists(file: string): boolean {
	try {
		lstatSync(file);
		return true;
	} catch {
		return false;
	}
}

function commitExists(
	root: string,
	sha: string,
	env: NodeJS.ProcessEnv = sanitizedGitEnv()
): boolean {
	return (
		spawnSync('git', ['--no-replace-objects', 'cat-file', '-e', `${sha}^{commit}`], {
			cwd: root,
			stdio: 'ignore',
			env
		}).status === 0
	);
}

function listWorkingTreeFiles(root: string): string[] {
	const result = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
	return String(result.stdout)
		.split('\0')
		.filter(Boolean)
		.map(toPosix)
		.filter((file) => pathEntryExists(path.join(root, file)));
}

function workingTreeRepository(root: string, files: readonly string[]): PolicyRepository {
	return {
		files,
		readText(file) {
			const absolute = path.resolve(root, file);
			if (!isInsideRoot(root, absolute))
				throw new Error(`Refusing to read outside repository: ${file}`);
			if (lstatSync(absolute).isSymbolicLink()) return readlinkSync(absolute, 'utf8');
			return readFileSync(absolute, 'utf8');
		},
		pathExists(file) {
			const absolute = path.resolve(root, file);
			return isInsideRoot(root, absolute) && pathEntryExists(absolute);
		},
		commitExists: (sha) => commitExists(root, sha)
	};
}

function listIndexEntries(root: string, env: NodeJS.ProcessEnv): IndexEntry[] {
	const result = git(root, ['ls-files', '--stage', '-z'], undefined, env);
	return String(result.stdout)
		.split('\0')
		.filter(Boolean)
		.map((record) => {
			const match = record.match(/^(\d{6}) ([0-9a-f]{40,64}) (\d)\t([\s\S]+)$/);
			if (!match) throw new Error(`Could not parse Git index entry: ${record}`);
			return {
				mode: match[1]!,
				oid: match[2]!,
				stage: Number(match[3]),
				file: toPosix(match[4]!)
			};
		});
}

function readIndexBlobs(
	root: string,
	oids: readonly string[],
	env: NodeJS.ProcessEnv
): Map<string, string> {
	const unique = [...new Set(oids)];
	if (unique.length === 0) return new Map();
	const result = git(
		root,
		['--no-replace-objects', 'cat-file', '--batch'],
		`${unique.join('\n')}\n`,
		env
	);
	const output = Buffer.from(result.stdout as Buffer);
	const values = new Map<string, string>();
	let cursor = 0;

	for (const requested of unique) {
		const newline = output.indexOf(0x0a, cursor);
		if (newline < 0) throw new Error(`Missing cat-file header for ${requested}.`);
		const header = output.subarray(cursor, newline).toString('utf8');
		const match = header.match(/^([0-9a-f]{40,64}) (\w+) (\d+)$/);
		if (!match) throw new Error(`Unexpected cat-file header: ${header}`);
		const size = Number(match[3]);
		const start = newline + 1;
		const end = start + size;
		if (end >= output.length) throw new Error(`Incomplete cat-file body for ${requested}.`);
		if (match[1] !== requested || match[2] !== 'blob') {
			throw new Error(`Index object ${requested} is not the requested blob.`);
		}
		values.set(requested, output.subarray(start, end).toString('utf8'));
		cursor = end + 1;
	}
	return values;
}

function assertPolicyRuntimeMatchesIndex(
	root: string,
	policy: KnowledgePolicyConfig,
	entries: readonly IndexEntry[],
	env: NodeJS.ProcessEnv
): void {
	const trackedRuntime = entries.filter((entry) => policy.repository.runtimeFiles(entry.file));
	const differences =
		trackedRuntime.length === 0
			? []
			: String(
					git(
						root,
						['diff', '--name-only', '-z', '--', ...trackedRuntime.map((entry) => entry.file)],
						undefined,
						env
					).stdout
				)
					.split('\0')
					.filter(Boolean);
	const untrackedRuntime = String(
		git(root, ['ls-files', '--others', '--exclude-standard', '-z'], undefined, env).stdout
	)
		.split('\0')
		.filter((file) => file && policy.repository.runtimeFiles(toPosix(file)));
	if (differences.length > 0 || untrackedRuntime.length > 0) {
		throw new Error(
			'Knowledge-policy runtime files have unstaged changes. Stage them before running staged checks.'
		);
	}
}

function indexRepository(
	root: string,
	policy: KnowledgePolicyConfig,
	entries: readonly IndexEntry[],
	env: NodeJS.ProcessEnv
): PolicyRepository {
	const conflicts = entries.filter((entry) => entry.stage !== 0);
	if (conflicts.length > 0) {
		throw new Error(
			`Git index contains unresolved entries: ${conflicts.map((item) => item.file).join(', ')}`
		);
	}
	const byFile = new Map(entries.map((entry) => [entry.file, entry]));
	const candidateOids = entries
		.filter((entry) => entry.mode !== '160000' && matchesKnowledgeCandidate(policy, entry.file))
		.map((entry) => entry.oid);
	const blobs = readIndexBlobs(root, candidateOids, env);
	return {
		files: entries.map((entry) => entry.file),
		readText(file) {
			const entry = byFile.get(file);
			if (!entry) throw new Error(`Index file does not exist: ${file}`);
			const value = blobs.get(entry.oid);
			if (value === undefined) throw new Error(`Index file is not a readable blob: ${file}`);
			return value;
		},
		pathExists(file) {
			if (byFile.has(file)) return true;
			const prefix = file.endsWith('/') ? file : `${file}/`;
			return entries.some((entry) => entry.file.startsWith(prefix));
		},
		commitExists: (sha) => commitExists(root, sha, env)
	};
}

export function policyScopeForFiles(
	policy: KnowledgePolicyConfig,
	files: readonly string[]
): KnowledgePolicyScope {
	return files.some((file) => policy.repository.runtimeFiles(file))
		? { kind: 'full' }
		: { kind: 'files', files };
}

export function runKnowledgePolicy(input: {
	root: string;
	policy: KnowledgePolicyConfig;
	scope: KnowledgePolicyScope;
}): PolicyRunResult {
	const root = path.resolve(input.root);
	let repository: PolicyRepository;
	let effectiveScope = input.scope;
	let escalatedFromFiles = false;

	if (input.scope.kind === 'files') {
		effectiveScope = policyScopeForFiles(input.policy, input.scope.files);
		escalatedFromFiles = effectiveScope.kind === 'full';
	}

	if (effectiveScope.kind === 'staged') {
		const env = stagedGitEnv(root);
		const entries = listIndexEntries(root, env);
		assertPolicyRuntimeMatchesIndex(root, input.policy, entries, env);
		repository = indexRepository(root, input.policy, entries, env);
	} else if (effectiveScope.kind === 'full') {
		repository = workingTreeRepository(root, listWorkingTreeFiles(root));
	} else {
		repository = workingTreeRepository(root, effectiveScope.files);
	}

	const candidateFiles = repository.files.filter((file) =>
		matchesKnowledgeCandidate(input.policy, file)
	);
	return {
		findings: evaluateKnowledgePolicy({ policy: input.policy, repository }),
		filesEvaluated: candidateFiles.length,
		scope: effectiveScope.kind,
		escalatedFromFiles
	};
}
