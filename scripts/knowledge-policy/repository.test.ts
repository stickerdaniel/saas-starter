import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blocking, defineKnowledgePolicy, exactPaths, fileExtension, underPath } from './policy';
import { runKnowledgePolicy } from './repository';

function gitWithEnv(root: string, args: string[], env = process.env, input?: string): string {
	const result = spawnSync('git', args, { cwd: root, env, input, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout.trim();
}

function git(root: string, ...args: string[]): string {
	return gitWithEnv(root, args);
}

function write(root: string, file: string, contents: string): void {
	mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	writeFileSync(path.join(root, file), contents);
}

const markdown = fileExtension('.md');
const testPolicy = defineKnowledgePolicy({
	mode: 'strict',
	repository: {
		candidates: markdown,
		ignore: underPath('ignored'),
		runtimeFiles: exactPaths('knowledge-policy.config.ts')
	},
	documents: {
		markdown,
		requireClassification: blocking,
		allowed: [{ id: 'docs', match: markdown, severity: blocking }],
		forbidden: []
	},
	links: { include: markdown, severity: blocking },
	textRules: []
});

describe('repository policy scopes', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'knowledge-policy-'));
		git(root, 'init', '-q', '-b', 'main');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		git(root, 'config', 'commit.gpgsign', 'false');
		write(root, 'README.md', '# Root\n');
		write(root, 'docs/target.md', '# Target\n');
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'Initial');
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it('full scope sees tracked and untracked files but not unstaged deletions', () => {
		write(root, 'new.md', '[missing](missing.md)\n');
		rmSync(path.join(root, 'docs/target.md'));
		const result = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'full' } });
		expect(result.filesEvaluated).toBe(2);
		expect(result.findings).toMatchObject([
			{ ruleId: 'knowledge.relative-link-missing', file: 'new.md' }
		]);
	});

	it('files scope checks selected sources and resolves targets in the whole working tree', () => {
		write(root, 'README.md', '[target](docs/target.md)\n');
		const result = runKnowledgePolicy({
			root,
			policy: testPolicy,
			scope: { kind: 'files', files: ['README.md'] }
		});
		expect(result).toMatchObject({ filesEvaluated: 1, scope: 'files', findings: [] });
	});

	it('staged scope reads the final index instead of unstaged working-tree content', () => {
		write(root, 'README.md', '[missing](missing.md)\n');
		git(root, 'add', 'README.md');
		write(root, 'README.md', '# Fixed only in working tree\n');
		const result = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'staged' } });
		expect(result.findings).toMatchObject([
			{ ruleId: 'knowledge.relative-link-missing', file: 'README.md' }
		]);
	});

	it('ignores replacement refs when reading staged policy blobs', () => {
		const hash = (contents: string): string => {
			const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
				cwd: root,
				input: contents,
				encoding: 'utf8'
			});
			if (result.status !== 0) throw new Error(result.stderr);
			return result.stdout.trim();
		};
		const original = hash('[missing](missing.md)\n');
		const replacement = hash('# Clean replacement\n');
		git(root, 'update-index', '--cacheinfo', `100644,${original},README.md`);
		git(root, 'replace', original, replacement);

		const result = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'staged' } });
		expect(result.findings).toMatchObject([
			{ ruleId: 'knowledge.relative-link-missing', file: 'README.md' }
		]);
	});

	it('reads an allowed external index through its explicit object stores', () => {
		const index = path.join(root, 'external-index');
		const objects = path.join(root, 'external-objects');
		const defaultObjects = path.join(root, '.git', 'objects');
		mkdirSync(objects);
		const externalEnv = {
			...process.env,
			GIT_INDEX_FILE: index,
			GIT_OBJECT_DIRECTORY: objects,
			GIT_ALTERNATE_OBJECT_DIRECTORIES: defaultObjects
		};
		gitWithEnv(root, ['read-tree', 'HEAD'], externalEnv);
		const objectId = gitWithEnv(
			root,
			['hash-object', '-w', '--stdin'],
			externalEnv,
			'[missing](missing.md)\n'
		);
		gitWithEnv(root, ['update-index', '--cacheinfo', `100644,${objectId},README.md`], externalEnv);

		const keys = [
			'GIT_DIR',
			'GIT_WORK_TREE',
			'GIT_INDEX_FILE',
			'GIT_OBJECT_DIRECTORY',
			'GIT_ALTERNATE_OBJECT_DIRECTORIES',
			'STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX'
		] as const;
		const saved = new Map(keys.map((key) => [key, process.env[key]]));
		try {
			process.env.GIT_DIR = path.join(root, 'foreign.git');
			process.env.GIT_WORK_TREE = path.join(root, 'foreign-worktree');
			process.env.GIT_INDEX_FILE = index;
			process.env.GIT_OBJECT_DIRECTORY = objects;
			process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = defaultObjects;
			process.env.STATIC_CHECKS_ALLOW_EXTERNAL_GIT_INDEX = '1';

			const result = runKnowledgePolicy({
				root,
				policy: testPolicy,
				scope: { kind: 'staged' }
			});
			expect(result.findings).toMatchObject([
				{ ruleId: 'knowledge.relative-link-missing', file: 'README.md' }
			]);
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	it('staged deletion and rename remove old link targets from the index', () => {
		write(root, 'README.md', '[target](docs/target.md)\n');
		git(root, 'add', 'README.md');
		git(root, 'mv', 'docs/target.md', 'docs/renamed.md');
		const result = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'staged' } });
		expect(result.findings).toMatchObject([
			{ ruleId: 'knowledge.relative-link-missing', file: 'README.md' }
		]);
	});

	it('accepts links to newly staged targets', () => {
		write(root, 'README.md', '[new](docs/new.md)\n');
		write(root, 'docs/new.md', '# New\n');
		git(root, 'add', '.');
		const result = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'staged' } });
		expect(result.findings).toEqual([]);
	});

	it('evaluates tracked symlinks as index-compatible link text in full scope', () => {
		writeFileSync(path.join(root, 'linked.md'), 'docs/target.md');
		git(root, 'add', 'linked.md');
		git(root, 'commit', '-qm', 'Add link placeholder');
		rmSync(path.join(root, 'linked.md'));
		const result = spawnSync('ln', ['-s', 'docs/target.md', 'linked.md'], {
			cwd: root,
			encoding: 'utf8'
		});
		if (result.status !== 0) throw new Error(result.stderr);
		const policyResult = runKnowledgePolicy({ root, policy: testPolicy, scope: { kind: 'full' } });
		expect(policyResult.findings).toEqual([]);
	});
});
