import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizedGitEnv } from './git-context';
import { compatibilityInvocation } from './static-checks';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');
const BUN = testExecutable('bun');

function run(args: string[], env = sanitizedGitEnv()) {
	return spawnSync(BUN, [SCRIPT, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		env
	});
}

function createCheckerClone(): { directory: string; repository: string } {
	const directory = path.join(ROOT, 'scratch', `static-compat-${process.pid}-${Date.now()}`);
	const repository = path.join(directory, 'repository');
	mkdirSync(directory, { recursive: true });
	try {
		const result = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', ROOT, repository],
			{ env: sanitizedGitEnv(), encoding: 'utf8' }
		);
		if (result.status !== 0) throw new Error(`Local checker clone failed: ${result.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		copyFileSync(SCRIPT, path.join(repository, 'scripts', 'static-checks.ts'));
		return { directory, repository };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

function writeFakeBun(directory: string): void {
	if (process.platform === 'win32') {
		const source = path.join(directory, 'fake-bun.ts');
		writeFileSync(
			source,
			String.raw`import { writeFileSync } from 'node:fs';
const log = process.env.STATIC_CHECK_LOG;
if (!log) process.exit(42);
writeFileSync(log, [process.argv[1] ?? '', process.env.GIT_DIR ?? '', process.env.GIT_WORK_TREE ?? '', process.env.CI ?? ''].join('\n') + '\n');
`
		);
		const result = spawnSync(
			BUN,
			['build', '--compile', source, '--outfile', path.join(directory, 'bun.exe')],
			{
				encoding: 'utf8'
			}
		);
		if (result.status !== 0) throw new Error(`Failed to compile fake Bun: ${result.stderr}`);
		return;
	}
	const command = path.join(directory, 'bun');
	writeFileSync(
		command,
		'#!/bin/sh\nprintf \'%s\\n%s\\n%s\\n%s\\n\' "$1" "${GIT_DIR-}" "${GIT_WORK_TREE-}" "${CI-}" > "$STATIC_CHECK_LOG"\n'
	);
	chmodSync(command, 0o755);
}

describe('Convex compatibility static-check entrypoint', () => {
	it('builds the sanitized child invocation', () => {
		const savedDir = process.env.GIT_DIR;
		const savedWorktree = process.env.GIT_WORK_TREE;
		process.env.GIT_DIR = path.join(ROOT, 'scratch', 'foreign.git');
		process.env.GIT_WORK_TREE = path.join(ROOT, 'scratch', 'foreign-worktree');
		try {
			const invocation = compatibilityInvocation(true);
			expect(invocation.command).toBe('bun');
			expect(invocation.args).toEqual(['scripts/convex-consumer-compat.ts']);
			expect(invocation.options.env?.GIT_DIR).toBeUndefined();
			expect(invocation.options.env?.GIT_WORK_TREE).toBeUndefined();
			expect(invocation.options.env?.CI).toBe('true');
		} finally {
			if (savedDir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = savedDir;
			if (savedWorktree === undefined) delete process.env.GIT_WORK_TREE;
			else process.env.GIT_WORK_TREE = savedWorktree;
		}
	});

	it('runs the compatibility child with the sanitized CI environment', () => {
		const directory = path.join(ROOT, 'scratch', `compat-child-${process.pid}-${Date.now()}`);
		const log = path.join(directory, 'child.log');
		mkdirSync(directory, { recursive: true });
		try {
			writeFakeBun(directory);
			const env = sanitizedGitEnv();
			env.PATH = `${directory}${path.delimiter}${env.PATH ?? ''}`;
			env.STATIC_CHECK_LOG = log;
			env.GIT_DIR = path.join(directory, 'foreign.git');
			env.GIT_WORK_TREE = path.join(directory, 'foreign-worktree');
			const result = run(['--ci', '--scope', 'compat'], env);
			const output = `${result.stdout}${result.stderr}`;
			const [argument, gitDir, gitWorktree, ci] = readFileSync(log, 'utf8').trimEnd().split('\n');

			expect(result.status, output).toBe(0);
			expect(argument).toBe('scripts/convex-consumer-compat.ts');
			expect(gitDir).toBe('');
			expect(gitWorktree).toBe('');
			expect(ci).toBe('true');
			expect(output).toContain('Convex consumer compatibility');
			expect(output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'rejects an unsafe repository path before the compatibility child runs',
		() => {
			const checkout = createCheckerClone();
			try {
				const payload = `${String.fromCharCode(0x1b)}]0;OWNED${String.fromCharCode(0x07)}`;
				const unsafeDirectory = path.join(checkout.repository, 'scripts', 'unsafe');
				const file = path.join(unsafeDirectory, `bad${payload}.md`);
				mkdirSync(unsafeDirectory, { recursive: true });
				writeFileSync(file, 'safe');
				const result = spawnSync(
					BUN,
					[path.join(checkout.repository, 'scripts', 'static-checks.ts'), '--scope', 'compat'],
					{ cwd: checkout.repository, encoding: 'utf8', env: sanitizedGitEnv() }
				);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status).toBe(1);
				expect(output).toContain('U+001B');
				expect(output).not.toContain(payload);
				expect(output).not.toContain(String.fromCharCode(0x07));
				expect(output).not.toContain('Convex consumer compatibility');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		}
	);

	it.each([
		['staged mode', ['--scope', 'compat', '--staged']],
		['an explicit file', ['--scope', 'compat', 'README.md']],
		['--files-from', ['--scope', 'compat', '--files-from', '-']]
	])('rejects %s before starting compatibility', (_label, args) => {
		const result = run(args);
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('--scope compat only supports a full-project run');
		expect(output).not.toContain('Convex consumer compatibility');
	});

	it('owns the package alias', () => {
		const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts['check:convex-compat']).toBe(
			'bun scripts/static-checks.ts --scope compat'
		);
	});
});
