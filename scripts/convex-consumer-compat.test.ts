import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { confectCodegen } from './confect-codegen';
import {
	brokenReferences,
	consumerReferencesIn,
	expandNamespaceReferences,
	identifiersIn,
	namespaceReferencesIn,
	registeredWorktreePaths,
	requiredReferences,
	scheduledIdentifiersIn
} from './convex-consumer-compat';
import { freshSurfaceOf, type Surface } from './convex-surface';
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
			import { api, internal } from './_generated/api';
			async function schedule(ctx) {
				await ctx.scheduler.runAfter(
					60_000,
					internal.emails.send.welcome,
					{}
				);
				await (ctx.scheduler).runAt(at, api.jobs.finish, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts').references).toEqual([
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
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/usage/record.ts').references).toEqual([
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

	it('records a top-level var and let makeFunctionReference target', () => {
		const source = `
			var first = makeFunctionReference<'mutation'>('jobs:first');
			let second = makeFunctionReference<'mutation'>('jobs:second');
			async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, first, {});
				await ctx.scheduler.runAt(at, second, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts').references).toEqual([
			{ identifier: 'jobs:first', visibility: 'public', file: 'src/lib/convex/jobs.ts' },
			{ identifier: 'jobs:first', visibility: 'internal', file: 'src/lib/convex/jobs.ts' },
			{ identifier: 'jobs:second', visibility: 'public', file: 'src/lib/convex/jobs.ts' },
			{ identifier: 'jobs:second', visibility: 'internal', file: 'src/lib/convex/jobs.ts' }
		]);
	});

	it('binds a shadowed target to its own declaration', () => {
		const source = `
			const target = makeFunctionReference<'mutation'>('jobs:old');
			async function schedule(ctx) {
				const target = makeFunctionReference<'mutation'>('jobs:new');
				await ctx.scheduler.runAfter(0, target, {});
			}
		`;
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts').references).toEqual([
			{ identifier: 'jobs:new', visibility: 'public', file: 'src/lib/convex/jobs.ts' },
			{ identifier: 'jobs:new', visibility: 'internal', file: 'src/lib/convex/jobs.ts' }
		]);
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
		expect(scheduledIdentifiersIn(source, 'src/lib/convex/jobs.ts').references).toEqual([
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
		).toEqual({ references: [], unresolved: [], unverifiedApiImports: [] });
	});

	it('fails closed on an internal re-exported through a barrel', () => {
		const file = 'src/lib/convex/jobs/queue.ts';
		const source = `
			import { internal } from './refs';
			export async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, internal.jobs.deliver, {});
			}
		`;
		expect(consumerReferencesIn([{ file, source }])).toMatchObject({
			references: [],
			unresolved: [{ file, expression: 'internal.jobs.deliver' }]
		});
	});

	it('keeps parameter and other imported targets out of the failing set', () => {
		const file = 'src/lib/convex/jobs/queue.ts';
		const source = `
			import { deliverLater } from './senders';
			export async function schedule(ctx, sender) {
				await ctx.scheduler.runAt(at, sender, {});
				await ctx.scheduler.runAfter(0, deliverLater, {});
			}
		`;
		expect(consumerReferencesIn([{ file, source }]).unresolved).toEqual([]);
	});
});

describe('scheduled targets under src/lib/confect', () => {
	const helper = 'src/lib/confect/support/delivery.ts';
	const deliver = {
		identifier: 'support/notifications:deliver',
		visibility: 'internal',
		file: helper
	} as const;
	const refresh = {
		identifier: 'users/profile:refresh',
		visibility: 'public',
		file: helper
	} as const;

	it('reads a ctx.scheduler target in a helper beside the functions directory', () => {
		const source = `
			import { internal } from '../../convex/_generated/api';
			export async function schedule(ctx) {
				await ctx.runMutation(internal.support.threads.touch, {});
				await ctx.scheduler.runAfter(0, internal.support.threads.sweepEmptyThread, {});
			}
		`;
		expect(consumerReferencesIn([{ file: helper, source }])).toEqual({
			references: [
				{ identifier: 'support/threads:sweepEmptyThread', visibility: 'internal', file: helper }
			],
			namespaces: [],
			unresolved: []
		});
	});

	it('resolves a Scheduler ref through the generated refs', () => {
		const source = `
			import * as Duration from 'effect/Duration';
			import * as Effect from 'effect/Effect';
			import refs from '../_generated/refs';
			import { Scheduler } from '../_generated/services';

			export const schedule = Effect.gen(function* () {
				const scheduler = yield* Scheduler;
				yield* scheduler.runAfter(Duration.minutes(5), refs.internal.support.notifications.deliver, {
					text: 'Hello'
				});
				yield* scheduler.runAt(at, refs.public.users.profile.refresh, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }])).toEqual({
			references: [deliver, refresh],
			namespaces: [],
			unresolved: []
		});
	});

	it('follows an aliased and destructured refs import', () => {
		const source = `
			import confectRefs from '../_generated/refs';
			import { Scheduler } from '../_generated/services';

			const { internal: confectInternal } = confectRefs;
			const {
				public: { users }
			} = confectRefs;

			export const schedule = Effect.gen(function* () {
				const { runAfter, runAt } = yield* Scheduler;
				yield* runAfter(Duration.zero, confectInternal.support.notifications.deliver, {});
				yield* runAt(at, users.profile.refresh, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([deliver, refresh]);
	});

	it('follows a ref stored in a local const before the call', () => {
		const source = `
			import refs from '../_generated/refs';

			export const schedule = Effect.gen(function* () {
				const target = refs.internal.support.notifications.deliver;
				yield* (yield* Scheduler).runAfter(Duration.zero, target, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([deliver]);
	});

	it('resolves a locally declared internal through its initializer', () => {
		const source = `
			import refs from '../_generated/refs';

			const internal = refs.internal.real;
			export const schedule = Effect.gen(function* () {
				yield* (yield* Scheduler).runAfter(Duration.zero, internal.jobs.deliver, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([
			{ identifier: 'real/jobs:deliver', visibility: 'internal', file: helper }
		]);
	});

	it('does not resolve an internal imported from an unrelated module', () => {
		const source = `
			import { internal } from '../support/paths';

			export async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, internal.jobs.deliver, {});
			}
		`;
		expect(consumerReferencesIn([{ file: helper, source }])).toMatchObject({
			references: [],
			unresolved: [{ file: helper, expression: 'internal.jobs.deliver' }]
		});
	});

	it('does not resolve an internal from a lookalike generated api module', () => {
		const source = `
			import { internal } from '../alternate/_generated/api';

			export async function schedule(ctx) {
				await ctx.scheduler.runAfter(0, internal.jobs.deliver, {});
			}
		`;
		expect(consumerReferencesIn([{ file: helper, source }])).toMatchObject({
			references: [],
			unresolved: [{ file: helper, expression: 'internal.jobs.deliver' }]
		});
	});

	it('reads a call whose method name is escaped', () => {
		const source = `
			import refs from '../_generated/refs';

			export const schedule = Effect.gen(function* () {
				yield* (yield* Scheduler)['run\\u0041fter'](Duration.zero, refs.internal.support.notifications.deliver, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([deliver]);
	});

	it('reads a call through a chain of scheduler aliases', () => {
		const source = `
			import refs from '../_generated/refs';

			export const schedule = Effect.gen(function* () {
				const scheduler = yield* Scheduler;
				const enqueue = scheduler.runAfter;
				const dispatch = enqueue;
				yield* dispatch(Duration.zero, refs.internal.support.notifications.deliver, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([deliver]);
	});

	it('reads calls through a renamed scheduler method', () => {
		const source = `
			import refs from '../_generated/refs';

			export const schedule = Effect.gen(function* () {
				const scheduler = yield* Scheduler;
				const enqueue = scheduler.runAfter;
				const { runAt: enqueueAt } = scheduler;
				yield* enqueue(Duration.zero, refs.internal.support.notifications.deliver, {});
				yield* enqueueAt(at, refs.public.users.profile.refresh, {});
			});
		`;
		expect(consumerReferencesIn([{ file: helper, source }]).references).toEqual([deliver, refresh]);
	});

	it('reports every target it cannot resolve with its file and line', () => {
		const source = [
			"import refs from '../other/refs';",
			'export const schedule = Effect.gen(function* () {',
			'	const scheduler = yield* Scheduler;',
			'	yield* scheduler.runAfter(Duration.zero, pick(kind), {});',
			'	yield* scheduler.runAfter(Duration.zero, refs.internal.support.notifications.deliver, {});',
			'});',
			'export async function admit(ctx, sender) {',
			'	await ctx.scheduler.runAt(at, sender, {});',
			'}'
		].join('\n');
		expect(consumerReferencesIn([{ file: helper, source }])).toEqual({
			references: [],
			namespaces: [],
			unresolved: [
				{ file: helper, line: 4, expression: 'pick(kind)' },
				{ file: helper, line: 5, expression: 'refs.internal.support.notifications.deliver' },
				{ file: helper, line: 8, expression: 'sender' }
			]
		});
	});

	it('leaves an unresolved target in the functions directory to the published surface', () => {
		const source =
			'export async function admit(ctx, sender) { await ctx.scheduler.runAt(at, sender, {}); }';
		expect(
			consumerReferencesIn([{ file: 'src/lib/convex/admission.ts', source }]).unresolved
		).toEqual([]);
	});
});

const GROUP_IMPL_IMPORTS = `import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import notifications from './notifications.spec';
`;

function notificationsSpec(names: readonly string[]): string {
	const functions = names.map(
		(name) =>
			`\n\t.addFunction(\n\t\tFunctionSpec.internalMutation({ name: '${name}', args: () => ({ text: Schema.String }), returns: () => Schema.Null })\n\t)`
	);
	return `import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make()${functions.join('')};
`;
}

function notificationsImpl(names: readonly string[]): string {
	const layers = names.map(
		(name) =>
			`\tLayer.provide(FunctionImpl.make(databaseSchema, notifications, '${name}', () => Effect.succeed(null))),`
	);
	return `${GROUP_IMPL_IMPORTS}
export default GroupImpl.make(databaseSchema, notifications).pipe(
${layers.join('\n')}
	GroupImpl.finalize
);
`;
}

const CONFECT_FIXTURE: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'fixture', private: true, type: 'module' }),
	'convex.json': JSON.stringify({ functions: 'src/lib/convex/' }),
	'src/lib/convex/convex.config.ts': `import { defineApp } from 'convex/server';

export default defineApp();
`,
	'src/lib/confect/tables/notes.ts': `import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() => Schema.Struct({ text: Schema.String }));
`,
	'src/lib/confect/support/delivery.ts': `import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import refs from '../_generated/refs';
import { Scheduler } from '../_generated/services';

export const scheduleDelivery = Effect.gen(function* () {
	const scheduler = yield* Scheduler;
	yield* scheduler.runAfter(Duration.minutes(5), refs.internal.support.notifications.deliver, {
		text: 'Hello'
	});
});

export const scheduleReminders = Effect.gen(function* () {
	const scheduler = yield* Scheduler;
	const enqueue = scheduler.runAfter;
	yield* enqueue(Duration.hours(1), refs.internal.support.notifications.remind, { text: 'Hello' });
	const { runAt: enqueueAt } = yield* Scheduler;
	yield* enqueueAt(DateTime.makeUnsafe('2030-01-01T00:00:00Z'), refs.internal.support.notifications.escalate, {
		text: 'Hello'
	});
});
`,
	'src/lib/confect/support/retries.ts': `import { internal } from '../../convex/_generated/api';
import type { MutationCtx } from '../../convex/_generated/server';

export async function scheduleRetry(ctx: MutationCtx): Promise<void> {
	await ctx.scheduler.runAfter(0, internal.support.notifications.retry, { text: 'Hello' });
}
`
};

describe('Confect scheduled targets against the generated surface', () => {
	it('fails when the head removes a target only src/lib/confect schedules', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'convex-compat-confect-'));
		try {
			for (const [file, contents] of Object.entries(CONFECT_FIXTURE)) {
				mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
				writeFileSync(path.join(root, file), contents);
			}
			copyFileSync(
				path.join(ROOT, 'src/lib/convex/tsconfig.json'),
				path.join(root, 'src/lib/convex/tsconfig.json')
			);
			symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
			const consumers = consumerReferencesIn(
				['src/lib/confect/support/delivery.ts', 'src/lib/confect/support/retries.ts'].map(
					(file) => ({ file, source: readFileSync(path.join(root, file), 'utf8') })
				)
			);
			const surfaceWith = async (names: readonly string[]) => {
				writeFileSync(
					path.join(root, 'src/lib/confect/support/notifications.spec.ts'),
					notificationsSpec(names)
				);
				writeFileSync(
					path.join(root, 'src/lib/confect/support/notifications.impl.ts'),
					notificationsImpl(names)
				);
				confectCodegen(root, 'local');
				return freshSurfaceOf(
					path.join(root, 'src/lib/convex'),
					new Set(consumers.references.map((ref) => ref.identifier))
				);
			};

			const promised = await surfaceWith(['deliver', 'remind', 'escalate', 'retry', 'keep']);
			const required = requiredReferences(consumers, promised);
			const available = await surfaceWith(['keep']);

			expect(brokenReferences(required, promised, promised)).toEqual([]);
			expect(brokenReferences(required, promised, available)).toEqual([
				{
					identifier: 'support/notifications:deliver',
					visibility: 'internal',
					file: 'src/lib/confect/support/delivery.ts'
				},
				{
					identifier: 'support/notifications:remind',
					visibility: 'internal',
					file: 'src/lib/confect/support/delivery.ts'
				},
				{
					identifier: 'support/notifications:escalate',
					visibility: 'internal',
					file: 'src/lib/confect/support/delivery.ts'
				},
				{
					identifier: 'support/notifications:retry',
					visibility: 'internal',
					file: 'src/lib/confect/support/retries.ts'
				}
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
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
