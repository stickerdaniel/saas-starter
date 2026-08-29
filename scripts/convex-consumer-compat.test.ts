import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	expandNamespaceReferences,
	identifiersIn,
	namespaceReferencesIn,
	scheduledIdentifiersIn
} from './convex-consumer-compat';
import type { Surface } from './convex-surface';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

const file = 'src/example.ts';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'convex-consumer-compat.ts');
const BUN = testExecutable('bun');

function compatibilityFixtureEnv(): NodeJS.ProcessEnv {
	const env = sanitizedGitEnv();
	delete env.CI;
	delete env.CONVEX_COMPAT_BASE;
	return env;
}

describe('Convex consumer references', () => {
	it('reads a direct public or internal function path', () => {
		expect(
			identifiersIn(
				'client.query(api.users.viewer, {}); ctx.runMutation(internal.jobs.run, {});',
				file
			)
		).toEqual([
			{ identifier: 'users:viewer', visibility: 'public', file },
			{ identifier: 'jobs:run', visibility: 'internal', file }
		]);
	});

	it('reads a namespace passed through an any adapter', () => {
		expect(namespaceReferencesIn('setup({ convexApi: (api as any).autumn });', file)).toEqual([
			{ prefix: 'autumn', visibility: 'public', file }
		]);
	});

	it('expands a direct function below an any cast', () => {
		const surface: Surface = new Map([
			['users:viewer', { kind: 'query', visibility: 'public' }],
			['users/viewer:child', { kind: 'query', visibility: 'public' }]
		]);
		const cast = namespaceReferencesIn('client.query((api as any).users.viewer, {});', file);
		expect(expandNamespaceReferences(cast, surface)).toEqual([
			{ identifier: 'users:viewer', visibility: 'public', file },
			{ identifier: 'users/viewer:child', visibility: 'public', file }
		]);
	});

	it('expands a namespace to every matching published function', () => {
		const surface: Surface = new Map([
			['autumn:check', { kind: 'action', visibility: 'public' }],
			['autumn:checkout', { kind: 'action', visibility: 'public' }],
			['autumn:privateTask', { kind: 'action', visibility: 'internal' }],
			['users:viewer', { kind: 'query', visibility: 'public' }]
		]);
		expect(
			expandNamespaceReferences([{ prefix: 'autumn', visibility: 'public', file }], surface)
		).toEqual([
			{ identifier: 'autumn:check', visibility: 'public', file },
			{ identifier: 'autumn:checkout', visibility: 'public', file }
		]);
	});

	it('reads persisted runAfter and runAt targets', () => {
		const source = `
			async function schedule(ctx) {
				await ctx.scheduler.runAfter(
					60_000,
					internal.emails.send.welcome,
					{}
				);
				await (ctx.scheduler).runAt(at, api.jobs.finish, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts')).toEqual([
			{
				identifier: 'emails/send:welcome',
				visibility: 'internal',
				file: 'src/lib/convex/jobs.ts'
			},
			{
				identifier: 'jobs:finish',
				visibility: 'public',
				file: 'src/lib/convex/jobs.ts'
			}
		]);
	});

	it('reads a static makeFunctionReference scheduler target', () => {
		const source = `
			const insertUsage = makeFunctionReference<'mutation'>('usage/record:insert');
			async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, insertUsage, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/usage/record.ts')).toEqual([
			{
				identifier: 'usage/record:insert',
				visibility: 'public',
				file: 'src/lib/convex/usage/record.ts'
			},
			{
				identifier: 'usage/record:insert',
				visibility: 'internal',
				file: 'src/lib/convex/usage/record.ts'
			}
		]);
	});

	it('does not bind a shadowed target to a top-level reference', () => {
		const source = `
			const target = makeFunctionReference<'mutation'>('jobs:old');
			async function schedule(ctx) {
				const target = makeFunctionReference<'mutation'>('jobs:new');
				await ctx.scheduler.runAfter(0, target, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts')).toEqual([]);
	});

	it('keeps a target shadowed only inside a sibling block', () => {
		const source = `
			const target = makeFunctionReference<'mutation'>('jobs:old');
			async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, target, {});
				if (true) {
					const target = makeFunctionReference<'mutation'>('jobs:new');
				}
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts')).toEqual([
			{ identifier: 'jobs:old', visibility: 'public', file: 'src/lib/convex/jobs.ts' },
			{ identifier: 'jobs:old', visibility: 'internal', file: 'src/lib/convex/jobs.ts' }
		]);
	});

	it('does not preserve an atomic direct call inside Convex', () => {
		expect(
			scheduledIdentifiersIn(
				'await ctx.runMutation(internal.jobs.finish, {});',
				'src/lib/convex/jobs.ts'
			)
		).toEqual([]);
	});
});

describe('Convex compatibility entrypoint', () => {
	it('fails when no trunk baseline exists', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-no-baseline-'));
		try {
			expect(
				spawnSync('git', ['init', '--quiet', '--initial-branch=feature'], {
					cwd: directory,
					env: sanitizedGitEnv()
				}).status
			).toBe(0);
			writeFileSync(path.join(directory, 'README.md'), 'fixture\n');
			expect(
				spawnSync('git', ['add', '--', 'README.md'], {
					cwd: directory,
					env: sanitizedGitEnv()
				}).status
			).toBe(0);
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						'Add fixture'
					],
					{ cwd: directory, env: sanitizedGitEnv() }
				).status
			).toBe(0);

			const env = compatibilityFixtureEnv();
			const result = spawnSync(BUN, [SCRIPT], {
				cwd: directory,
				encoding: 'utf8',
				env
			});
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status).toBe(1);
			expect(output).toContain('no trunk to compare against (looked for origin/main and main)');
			expect(output).toContain('compatibility cannot be certified without a baseline');
			expect(output).not.toContain('Skipping');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('fails when shallow trunk history hides the previous commit', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-shallow-'));
		const source = path.join(directory, 'source');
		const shallow = path.join(directory, 'shallow');
		const env = compatibilityFixtureEnv();
		const git = (cwd: string, args: string[]) =>
			spawnSync('git', args, { cwd, env, encoding: 'utf8' });
		try {
			mkdirSync(source);
			expect(git(source, ['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			for (const [message, content] of [
				['Initial', 'one\n'],
				['Update', 'two\n']
			] as const) {
				writeFileSync(path.join(source, 'README.md'), content);
				expect(git(source, ['add', '--', 'README.md']).status).toBe(0);
				expect(
					git(source, [
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						message
					]).status
				).toBe(0);
			}
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'protocol.file.allow=always',
						'clone',
						'--quiet',
						'--depth',
						'1',
						pathToFileURL(source).href,
						shallow
					],
					{ env, encoding: 'utf8' }
				).status
			).toBe(0);

			const result = spawnSync(BUN, [SCRIPT], {
				cwd: shallow,
				encoding: 'utf8',
				env
			});
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status).toBe(1);
			expect(output).toContain('trunk history is shallow');
			expect(output).toContain('compatibility cannot be certified');
			expect(output).not.toContain('root commit');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('fetches a baseline that only global transport configuration can reach', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-transport-'));
		const source = path.join(directory, 'source');
		const consumer = path.join(directory, 'consumer');
		const config = path.join(directory, 'global.gitconfig');
		const env = compatibilityFixtureEnv();
		const git = (cwd: string, args: string[]) =>
			spawnSync('git', args, { cwd, env, encoding: 'utf8' });
		const commit = (cwd: string, message: string) =>
			git(cwd, [
				'-c',
				'user.name=Probe',
				'-c',
				'user.email=probe@example.com',
				'commit',
				'--quiet',
				'--no-gpg-sign',
				'--no-verify',
				'-m',
				message
			]);
		try {
			mkdirSync(source);
			expect(git(source, ['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			writeFileSync(path.join(source, 'README.md'), 'one\n');
			expect(git(source, ['add', '--', 'README.md']).status).toBe(0);
			expect(commit(source, 'Initial').status).toBe(0);
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'protocol.file.allow=always',
						'clone',
						'--quiet',
						pathToFileURL(source).href,
						consumer
					],
					{ env, encoding: 'utf8' }
				).status
			).toBe(0);

			// Only reachable through the source repository, and only after a fetch.
			writeFileSync(path.join(source, 'README.md'), 'two\n');
			expect(git(source, ['add', '--', 'README.md']).status).toBe(0);
			expect(commit(source, 'Deployed').status).toBe(0);
			const deployed = git(source, ['rev-parse', 'HEAD']).stdout.trim();

			// The remote is a name no transport understands. Resolving it lives entirely in
			// global configuration, which is exactly what an isolated environment removes.
			expect(git(consumer, ['remote', 'set-url', 'origin', 'probe:repository']).status).toBe(0);
			expect(
				spawnSync(
					'git',
					[
						'config',
						'--file',
						config,
						`url.${pathToFileURL(source).href}.insteadOf`,
						'probe:repository'
					],
					{ env, encoding: 'utf8' }
				).status
			).toBe(0);
			expect(
				spawnSync('git', ['config', '--file', config, 'protocol.file.allow', 'always'], {
					env,
					encoding: 'utf8'
				}).status
			).toBe(0);

			const result = spawnSync(BUN, [SCRIPT], {
				cwd: consumer,
				encoding: 'utf8',
				env: {
					...env,
					CI: 'true',
					CONVEX_COMPAT_BASE: deployed,
					GIT_CONFIG_GLOBAL: config
				}
			});
			const output = `${result.stdout}${result.stderr}`;

			expect(output, output).not.toContain('is unreachable');
			expect(output).not.toContain('using the trunk instead');
			expect(git(consumer, ['rev-parse', '--verify', `${deployed}^{commit}`]).status).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);

	it('accepts a shallow clone whose HEAD is a genuine root commit', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-root-'));
		const source = path.join(directory, 'source');
		const shallow = path.join(directory, 'shallow');
		const env = compatibilityFixtureEnv();
		const git = (cwd: string, args: string[]) =>
			spawnSync('git', args, { cwd, env, encoding: 'utf8' });
		try {
			mkdirSync(source);
			expect(
				spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: source, env }).status
			).toBe(0);
			writeFileSync(path.join(source, 'README.md'), 'root\n');
			expect(spawnSync('git', ['add', '--', 'README.md'], { cwd: source, env }).status).toBe(0);
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						'Initial',
						'-m',
						'parent deadbeef'
					],
					{ cwd: source, env }
				).status
			).toBe(0);
			expect(git(source, ['switch', '--orphan', 'other']).status).toBe(0);
			writeFileSync(path.join(source, 'README.md'), 'other one\n');
			expect(git(source, ['add', '--', 'README.md']).status).toBe(0);
			for (const [message, content] of [
				['Other root', 'other one\n'],
				['Other update', 'other two\n']
			] as const) {
				writeFileSync(path.join(source, 'README.md'), content);
				expect(git(source, ['add', '--', 'README.md']).status).toBe(0);
				expect(
					git(source, [
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						message
					]).status
				).toBe(0);
			}
			expect(git(source, ['switch', '--quiet', 'main']).status).toBe(0);
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'protocol.file.allow=always',
						'clone',
						'--quiet',
						'--no-single-branch',
						'--depth',
						'1',
						pathToFileURL(source).href,
						shallow
					],
					{ env }
				).status
			).toBe(0);

			expect(git(shallow, ['rev-parse', '--is-shallow-repository']).stdout.trim()).toBe('true');
			const result = spawnSync(BUN, [SCRIPT], { cwd: shallow, encoding: 'utf8', env });
			expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
			expect(`${result.stdout}${result.stderr}`).toContain('root commit, nothing promised yet');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('fails when shallow feature and trunk tips hide their merge base', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-merge-base-'));
		const source = path.join(directory, 'source');
		const shallow = path.join(directory, 'shallow');
		const env = compatibilityFixtureEnv();
		const git = (cwd: string, args: string[]) =>
			spawnSync('git', args, { cwd, env, encoding: 'utf8' });
		const commit = (cwd: string, message: string, content: string) => {
			writeFileSync(path.join(cwd, 'README.md'), content);
			expect(git(cwd, ['add', '--', 'README.md']).status).toBe(0);
			expect(
				git(cwd, [
					'-c',
					'user.name=Probe',
					'-c',
					'user.email=probe@example.com',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'--no-verify',
					'-m',
					message
				]).status
			).toBe(0);
		};
		try {
			mkdirSync(source);
			expect(git(source, ['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			commit(source, 'Initial', 'initial\n');
			expect(git(source, ['branch', 'feature']).status).toBe(0);
			commit(source, 'Main update', 'main\n');
			expect(git(source, ['switch', '--quiet', 'feature']).status).toBe(0);
			commit(source, 'Feature update', 'feature\n');
			expect(
				spawnSync(
					'git',
					[
						'-c',
						'protocol.file.allow=always',
						'clone',
						'--quiet',
						'--depth',
						'1',
						'--branch',
						'feature',
						pathToFileURL(source).href,
						shallow
					],
					{ env }
				).status
			).toBe(0);
			expect(
				git(shallow, [
					'-c',
					'protocol.file.allow=always',
					'fetch',
					'--quiet',
					'--depth',
					'1',
					'origin',
					'main:refs/remotes/origin/main'
				]).status
			).toBe(0);

			const result = spawnSync(BUN, [SCRIPT], { cwd: shallow, encoding: 'utf8', env });
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status).toBe(1);
			expect(output).toContain('branch merge base is unavailable');
			expect(output).toContain('compatibility cannot be certified');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);
});
