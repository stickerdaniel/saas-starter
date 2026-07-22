import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blocking, defineKnowledgePolicy, exactPaths, fileExtension, underPath } from './policy';
import { runKnowledgePolicy } from './repository';

function git(root: string, ...args: string[]): string {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout.trim();
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
