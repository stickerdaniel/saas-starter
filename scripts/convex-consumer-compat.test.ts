import { describe, expect, it } from 'vitest';

import {
	expandNamespaceReferences,
	identifiersIn,
	namespaceReferencesIn,
	scheduledIdentifiersIn
} from './convex-consumer-compat';
import type { Surface } from './convex-surface';

const file = 'src/example.ts';

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

	it('does not preserve an atomic direct call inside Convex', () => {
		expect(
			scheduledIdentifiersIn(
				'await ctx.runMutation(internal.jobs.finish, {});',
				'src/lib/convex/jobs.ts'
			)
		).toEqual([]);
	});
});
