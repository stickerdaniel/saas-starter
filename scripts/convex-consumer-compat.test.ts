import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	commitTree,
	consumerSourcesAt,
	registeredWorktreePaths,
	type Layout
} from './convex-consumer-compat';
import {
	COMPAT_CASE_TIMEOUT_MS,
	flatCheckout,
	memberManifest,
	withLayoutFixture,
	workspaceCheckout,
	type CheckoutFiles
} from './__fixtures__/static-checks/compat-harness';
import { backendPaths, consumerReferencesIn } from './convex-references';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

const FLAT_LAYOUT = {
	kind: 'flat',
	backendRoot: '',
	backend: backendPaths('src/lib/convex')
} as const satisfies Layout;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'convex-consumer-compat.ts');
const BUN = testExecutable('bun');

function compatibilityFixtureEnv(): NodeJS.ProcessEnv {
	const env = sanitizedGitEnv();
	delete env.CI;
	delete env.CONVEX_COMPAT_BASE;
	return env;
}

describe('worktree cleanup', () => {
	it('recognizes a locked administrative entry that prune retains', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-locked-'));
		const repository = path.join(directory, 'repository');
		const checkout = path.join(directory, 'checkout');
		const env = compatibilityFixtureEnv();
		const git = (args: string[]) =>
			spawnSync('git', args, { cwd: repository, env, encoding: 'utf8' });
		try {
			mkdirSync(repository);
			expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			writeFileSync(path.join(repository, 'README.md'), 'fixture\n');
			expect(git(['add', '--', 'README.md']).status).toBe(0);
			expect(
				git([
					'-c',
					'user.name=Probe',
					'-c',
					'user.email=probe@example.com',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'--no-verify',
					'-m',
					'Initial'
				]).status
			).toBe(0);
			expect(git(['worktree', 'add', '--detach', '--quiet', checkout, 'HEAD']).status).toBe(0);
			expect(git(['worktree', 'lock', checkout]).status).toBe(0);
			rmSync(checkout, { recursive: true, force: true });

			// A locked entry is valid administrative state to Git. Prune evaluates it, returns 0,
			// and deliberately keeps it, so command status alone cannot prove cleanup.
			expect(git(['worktree', 'prune']).status).toBe(0);
			const listed = git(['worktree', 'list', '--porcelain', '-z']);
			expect(listed.status, listed.stderr).toBe(0);
			expect(registeredWorktreePaths(listed.stdout)).toContain(path.normalize(checkout));
		} finally {
			git(['worktree', 'unlock', checkout]);
			git(['worktree', 'prune']);
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('Convex consumer references', () => {
	it('keeps a Unicode consumer path from the baseline commit', () => {
		const repository = mkdtempSync(path.join(tmpdir(), 'convex-compat-unicode-'));
		const env = compatibilityFixtureEnv();
		const git = (args: string[]) =>
			spawnSync('git', args, { cwd: repository, env, encoding: 'utf8' });
		try {
			expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			const route = path.join(repository, 'src', 'routes', 'überblick');
			mkdirSync(route, { recursive: true });
			writeFileSync(
				path.join(route, '+page.server.ts'),
				`import { api } from '#lib/convex/_generated/api.js';

void api.compatUnicodeTarget.viewer;
`
			);
			expect(git(['add', '--all']).status).toBe(0);
			expect(
				git([
					'-c',
					'user.name=Probe',
					'-c',
					'user.email=probe@example.com',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'--no-verify',
					'-m',
					'Add Unicode consumer'
				]).status
			).toBe(0);
			const baseline = git(['rev-parse', 'HEAD']).stdout.trim();

			expect(
				consumerReferencesIn(
					consumerSourcesAt(commitTree(baseline, repository), FLAT_LAYOUT),
					FLAT_LAYOUT.backend
				).references
			).toEqual([
				{
					identifier: 'compatUnicodeTarget:viewer',
					visibility: 'public',
					file: 'src/routes/überblick/+page.server.ts'
				}
			]);
		} finally {
			rmSync(repository, { recursive: true, force: true });
		}
	});
});

describe('Convex compatibility entrypoint', () => {
	it('fails on a Confect scheduled target it cannot resolve', () => {
		const scratch = path.join(ROOT, 'scratch');
		mkdirSync(scratch, { recursive: true });
		const directory = mkdtempSync(path.join(scratch, 'convex-compat-unresolved-'));
		const env = compatibilityFixtureEnv();
		const git = (args: string[]) =>
			spawnSync('git', args, { cwd: directory, env, encoding: 'utf8' });
		const commit = (message: string) => {
			expect(git(['add', '--all']).status).toBe(0);
			expect(
				git([
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
		const unresolvedHelper = (target: string) =>
			[
				'export const schedule = Effect.gen(function* () {',
				'	const scheduler = yield* Scheduler;',
				`	yield* scheduler.runAfter(Duration.zero, ${target}, {});`,
				'});',
				''
			].join('\n');
		try {
			expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			mkdirSync(path.join(directory, 'src/lib/confect'), { recursive: true });
			mkdirSync(path.join(directory, 'src/lib/convex'), { recursive: true });
			copyFileSync(path.join(ROOT, 'convex.json'), path.join(directory, 'convex.json'));
			copyFileSync(
				path.join(ROOT, 'src/lib/convex/tsconfig.json'),
				path.join(directory, 'src/lib/convex/tsconfig.json')
			);
			writeFileSync(path.join(directory, 'src/lib/confect/old.ts'), unresolvedHelper('pickOld()'));
			commit('Baseline');
			const baseline = git(['rev-parse', 'HEAD']).stdout.trim();
			rmSync(path.join(directory, 'src/lib/confect/old.ts'));
			writeFileSync(path.join(directory, 'README.md'), 'head\n');
			commit('Head');
			writeFileSync(path.join(directory, 'src/lib/confect/new.ts'), unresolvedHelper('pickNew()'));

			const result = spawnSync(BUN, [SCRIPT], { cwd: directory, encoding: 'utf8', env });
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(1);
			expect(output).toContain('src/lib/confect/new.ts:3 pickNew() (working tree)');
			expect(output).toContain(`src/lib/confect/old.ts:3 pickOld() (at ${baseline.slice(0, 8)})`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

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

const users = (viewer: string | null) => {
	const builders = [...new Set(['queryGeneric', ...(viewer ? [viewer] : [])])].sort();
	return [
		`import { ${builders.join(', ')} } from 'convex/server';`,
		'',
		...(viewer ? [`export const viewer = ${viewer}({ handler: async () => null });`] : []),
		'export const settings = queryGeneric({ handler: async () => null });',
		''
	].join('\n');
};

const jobs = (
	finish: boolean
) => `import { ${finish ? 'internalMutationGeneric, ' : ''}mutationGeneric } from 'convex/server';
import { internal } from './_generated/api';

export const start = mutationGeneric({
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.jobs.finish, {});
		return null;
	}
});
${finish ? '\nexport const finish = internalMutationGeneric({ handler: async () => null });\n' : ''}`;

const AUTUMN = `import { actionGeneric } from 'convex/server';

export const check = actionGeneric({ handler: async () => null });
`;

const APP: CheckoutFiles = {
	'src/lib/convex/users.ts': users('queryGeneric'),
	'src/lib/convex/jobs.ts': jobs(true),
	'src/lib/convex/autumn.ts': AUTUMN,
	'src/routes/+page.ts': `import { api } from '#lib/convex/_generated/api.js';

export const load = () => ({ viewer: api.users.viewer, billing: (api as any).autumn });
`,
	'src/routes/account/+page.svelte': `<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';

	const settings = useQuery(api.users.settings, {});
</script>
`
};

const unresolvedSchedule = [
	'export const schedule = Effect.gen(function* () {',
	'	const scheduler = yield* Scheduler;',
	'	yield* scheduler.runAfter(Duration.zero, pickNew(), {});',
	'});',
	''
].join('\n');

describe('Convex compatibility across layouts', () => {
	it(
		'passes a flat baseline against a workspace head that only moves files',
		() => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				const baseline = fixture.commit('Baseline');
				fixture.checkout(workspaceCheckout(APP));
				fixture.commit('Move');

				const { status, output } = fixture.run();
				expect(status, output).toBe(0);
				expect(output).toContain(
					`convex-consumer-compat: ${baseline.slice(0, 8)} has the flat layout with its functions in src/lib/convex: 2 consumers, 3 scheduler modules.`
				);
				expect(output).toContain(
					'convex-consumer-compat: the working tree has the workspace layout with its functions in packages/backend/convex: 2 consumers, 3 scheduler modules.'
				);
				expect(output).toContain('4 referenced functions still published unchanged.');
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it.each([
		[
			'a deletion',
			{ 'src/lib/convex/users.ts': users(null) },
			'users:viewer: no longer exported',
			'src/routes/+page.ts'
		],
		[
			'a kind change',
			{ 'src/lib/convex/users.ts': users('mutationGeneric') },
			'users:viewer: now a mutation, was a query',
			'src/routes/+page.ts'
		],
		[
			'a visibility change',
			{ 'src/lib/convex/users.ts': users('internalQueryGeneric') },
			'users:viewer: now internal, was public',
			'src/routes/+page.ts'
		],
		[
			'a namespace loss',
			{ 'src/lib/convex/autumn.ts': null },
			'autumn:check: no longer exported',
			'src/routes/+page.ts'
		],
		[
			'a scheduler target loss',
			{ 'src/lib/convex/jobs.ts': jobs(false) },
			'jobs:finish: no longer exported',
			'src/lib/convex/jobs.ts'
		]
	] as const)(
		'fails a workspace head with %s and names the old identifier',
		(_label, change, fate, consumer) => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				const baseline = fixture.commit('Baseline');
				const head: Record<string, string> = { ...APP };
				for (const [file, text] of Object.entries(change)) {
					if (text === null) delete head[file];
					else head[file] = text;
				}
				fixture.checkout(workspaceCheckout(head));
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain(`  ${fate}`);
				expect(output).toContain(`referenced at ${baseline.slice(0, 8)} from ${consumer}`);
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it(
		'fails on a removal the workspace head has not committed',
		() => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				const baseline = fixture.commit('Baseline');
				fixture.checkout(workspaceCheckout(APP));
				fixture.commit('Move');
				fixture.edit({ 'packages/backend/convex/users.ts': users(null) });

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain('  users:viewer: no longer exported');
				expect(output).toContain(`referenced at ${baseline.slice(0, 8)} from src/routes/+page.ts`);
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it(
		'reads every app that a workspace baseline names',
		() => {
			withLayoutFixture((fixture) => {
				const admin = {
					'apps/admin/package.json': memberManifest('@repo/admin'),
					'apps/admin/src/routes/+page.ts': `import { api } from '@repo/backend/convex/_generated/api';

export const load = () => api.users.settings;
`
				};
				const app = { ...APP, 'src/routes/account/+page.svelte': '<p>Account</p>\n' };
				fixture.checkout({ ...workspaceCheckout(app), ...admin });
				const baseline = fixture.commit('Baseline');
				fixture.checkout({
					...workspaceCheckout({
						...app,
						'src/lib/convex/users.ts': users('queryGeneric').replace(
							/export const settings[^\n]*\n/,
							''
						)
					}),
					...admin
				});
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain(
					`convex-consumer-compat: ${baseline.slice(0, 8)} has the workspace layout with its functions in packages/backend/convex: 3 consumers, 3 scheduler modules.`
				);
				expect(output).toContain('  users:settings: no longer exported');
				expect(output).toContain(
					`referenced at ${baseline.slice(0, 8)} from apps/admin/src/routes/+page.ts`
				);
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it(
		'reads a baseline consumer whose path is not ASCII',
		() => {
			withLayoutFixture((fixture) => {
				const app = {
					...APP,
					'src/routes/überblick/+page.ts': `import { api } from '#lib/convex/_generated/api.js';

export const load = () => api.users.settings;
`
				};
				fixture.checkout(flatCheckout(app));
				const baseline = fixture.commit('Baseline');
				const { 'src/routes/überblick/+page.ts': _moved, ...rest } = app;
				fixture.checkout(
					workspaceCheckout({
						...rest,
						'src/routes/account/+page.svelte': '<p>Account</p>\n',
						'src/lib/convex/users.ts': users('queryGeneric').replace(
							/export const settings[^\n]*\n/,
							''
						)
					})
				);
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain('  users:settings: no longer exported');
				expect(output).toContain(
					`referenced at ${baseline.slice(0, 8)} from src/routes/account/+page.svelte, src/routes/überblick/+page.ts`
				);
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it(
		'reads a baseline without templateSetupVersion as flat',
		() => {
			withLayoutFixture((fixture) => {
				fixture.checkout(
					flatCheckout(APP, ({ templateSetupVersion: _version, ...manifest }) => manifest)
				);
				const baseline = fixture.commit('Baseline');
				fixture.checkout(workspaceCheckout(APP));
				fixture.commit('Move');

				const { status, output } = fixture.run();
				expect(status, output).toBe(0);
				expect(output).toContain(`${baseline.slice(0, 8)} has the flat layout`);
				expect(output).toContain('4 referenced functions still published unchanged.');
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it(
		'reads a workspace revision by the convex.json of its member, not one below it',
		() => {
			withLayoutFixture((fixture) => {
				const nested = {
					'packages/backend/scripts/__fixtures__/alt/convex.json': '{ "functions": "./" }\n',
					'packages/backend/scripts/__fixtures__/alt/alt.ts': 'export const alt = 1;\n'
				};
				fixture.checkout({ ...workspaceCheckout(APP), ...nested });
				const baseline = fixture.commit('Baseline');
				fixture.edit({ 'README.md': 'head\n' });
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(0);
				expect(output).toContain(
					`${baseline.slice(0, 8)} has the workspace layout with its functions in packages/backend/convex`
				);
				expect(output).toContain('4 referenced functions still published unchanged.');
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it.each([
		[
			'a hidden directory that a wildcard matches',
			{
				'packages/.hidden/package.json': memberManifest('@repo/hidden'),
				'packages/.hidden/convex.json': '{ "functions": "./" }\n',
				'packages/.hidden/src/stray.ts': 'export const stray = 1;\n'
			}
		],
		[
			'a directory whose manifest has no name',
			{
				'packages/fixture/package.json': '{ "type": "module" }\n',
				'packages/fixture/convex.json': '{ "functions": "./" }\n',
				'packages/fixture/src/stray.ts': 'export const stray = 1;\n'
			}
		]
	])(
		'takes no workspace member from %s',
		(_title, stray) => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				fixture.commit('Baseline');
				fixture.checkout({ ...workspaceCheckout(APP), ...stray });
				fixture.commit('Move');

				const { status, output } = fixture.run();
				expect(status, output).toBe(0);
				expect(output).toContain(
					'convex-consumer-compat: the working tree has the workspace layout with its functions in packages/backend/convex: 2 consumers, 3 scheduler modules.'
				);
				expect(output).toContain('4 referenced functions still published unchanged.');
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it.each([
		['flat', flatCheckout, 'src/lib/confect/pick.ts'],
		['workspace', workspaceCheckout, 'packages/backend/confect/pick.ts']
	] as const)(
		'fails a %s head whose scheduled target does not resolve',
		(_layout, checkout, file) => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				fixture.commit('Baseline');
				fixture.checkout(checkout({ ...APP, 'src/lib/confect/pick.ts': unresolvedSchedule }));
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain(`${file}:3 pickNew() (working tree)`);
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);

	it.each([
		[
			'two backends',
			(files: CheckoutFiles) => ({
				...workspaceCheckout(files),
				'convex.json': flatCheckout({})['convex.json']!
			}),
			'the working tree holds convex.json and packages/backend/convex.json, so this check cannot tell which one is its backend.'
		],
		[
			'no backend',
			(files: CheckoutFiles) => {
				const { 'packages/backend/convex.json': _config, ...rest } = workspaceCheckout(files);
				return rest;
			},
			'the working tree holds no convex.json at its root or at the root of a member that package.json names in workspaces (apps/web, packages/backend), so this check cannot tell where its backend is.'
		],
		[
			'a functions directory it does not hold',
			(files: CheckoutFiles) => ({
				...workspaceCheckout(files),
				'packages/backend/convex.json': flatCheckout({})['convex.json']!
			}),
			'packages/backend/convex.json at the working tree names the functions directory packages/backend/src/lib/convex, which the working tree does not hold.'
		],
		[
			'a templateSetupVersion the tree contradicts',
			(files: CheckoutFiles) =>
				flatCheckout(files, (manifest) => ({ ...manifest, templateSetupVersion: 3 })),
			'package.json at the working tree declares templateSetupVersion 3, and convex.json gives it the flat layout, which takes 1 or 2.'
		]
	] as const)(
		'refuses a revision with %s',
		(_label, shape, refusal) => {
			withLayoutFixture((fixture) => {
				fixture.checkout(flatCheckout(APP));
				fixture.commit('Baseline');
				fixture.checkout(shape(APP));
				fixture.commit('Head');

				const { status, output } = fixture.run();
				expect(status, output).toBe(1);
				expect(output).toContain(`convex-consumer-compat: ${refusal}`);
				expect(output).not.toContain('referenced functions still published unchanged');
			});
		},
		COMPAT_CASE_TIMEOUT_MS
	);
});
