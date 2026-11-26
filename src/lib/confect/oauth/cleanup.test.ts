// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { createFunctionHandle, type FunctionArgs, type FunctionReturnType } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const HOUR = 60 * 60 * 1000;
const LARGE_METADATA = 'x'.repeat(600_000);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

type CreateInput = FunctionArgs<typeof components.betterAuth.adapter.create>['input'];
type Model = FunctionArgs<typeof components.betterAuth.adapter.findMany>['model'];
type Page = FunctionReturnType<typeof components.betterAuth.adapter.findMany>;

const create = (t: Harness, input: CreateInput) =>
	t.mutation(components.betterAuth.adapter.create, { input });

const rows = async (t: Harness, model: Model) => {
	const found: Array<Record<string, unknown>> = [];
	let cursor: string | null = null;
	for (;;) {
		const result: Page = await t.query(components.betterAuth.adapter.findMany, {
			model,
			paginationOpts: { cursor, numItems: 200 }
		});
		found.push(...result.page);
		if (result.isDone) return found;
		cursor = result.continueCursor;
	}
};

const scheduledJobs = (t: Harness) =>
	t.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').take(500)).length);

const runToCompletion = async (t: Harness, run: () => Promise<unknown>) => {
	await run();
	await t.finishAllScheduledFunctions(vi.runAllTimers);
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('deleteStaleClients', () => {
	it('deletes old clients without a consent, behind a page of kept ones', async () => {
		const t = harness();
		const start = Date.now();
		const client = async (clientId: string, metadata?: string) => {
			await create(t, {
				model: 'oauthClient',
				data: {
					clientId,
					name: clientId,
					redirectUris: ['http://127.0.0.1:43111/callback'],
					createdAt: Date.now(),
					...(metadata ? { metadata } : {})
				}
			});
			await create(t, { model: 'oauthClientResource', data: { clientId, resourceId: 'resource' } });
		};
		for (let index = 0; index < 60; index++) {
			await client(`kept-${index}`);
			await create(t, {
				model: 'oauthConsent',
				data: {
					clientId: `kept-${index}`,
					userId: 'user',
					referenceId: '0',
					scopes: ['mcp:read']
				}
			});
		}
		for (let index = 0; index < 8; index++) await client(`stale-${index}`, LARGE_METADATA);
		vi.setSystemTime(start + 24 * HOUR);
		await client('young');
		vi.setSystemTime(start + 25 * HOUR);

		await runToCompletion(t, () => t.mutation(internal.oauth.cleanup.deleteStaleClients, {}));

		const clientIds = (await rows(t, 'oauthClient')).map((row) => row.clientId);
		expect(clientIds).toHaveLength(61);
		expect(clientIds).toContain('young');
		expect(clientIds.filter((id) => String(id).startsWith('stale-'))).toEqual([]);
		const links = (await rows(t, 'oauthClientResource')).map((row) => row.clientId);
		expect(links).toHaveLength(61);
		expect(links.filter((id) => String(id).startsWith('stale-'))).toEqual([]);
	});
});

describe('deleteExpiredTokens', () => {
	it('deletes expired rows past one page and keeps an unexpired rotated parent', async () => {
		const t = harness();
		const now = Date.now();
		for (let index = 0; index < 130; index++) {
			const expired = {
				clientId: 'client',
				userId: 'user',
				scopes: ['mcp:read'],
				expiresAt: now - HOUR
			};
			await create(t, {
				model: 'oauthAccessToken',
				data: { ...expired, token: `access-${index}` }
			});
			await create(t, {
				model: 'oauthRefreshToken',
				data: { ...expired, token: `refresh-${index}` }
			});
		}
		const live = {
			clientId: 'client',
			userId: 'user',
			scopes: ['mcp:read'],
			expiresAt: now + HOUR
		};
		await create(t, {
			model: 'oauthRefreshToken',
			data: { ...live, token: 'rotated-parent', revoked: now, rotatedAt: now }
		});
		await create(t, { model: 'oauthAccessToken', data: { ...live, token: 'live-access' } });

		await runToCompletion(t, () => t.mutation(internal.oauth.cleanup.deleteExpiredTokens, {}));

		expect((await rows(t, 'oauthAccessToken')).map((row) => row.token)).toEqual(['live-access']);
		expect((await rows(t, 'oauthRefreshToken')).map((row) => row.token)).toEqual([
			'rotated-parent'
		]);
	});
});

describe('eraseUserGrants', () => {
	it('runs when the user is deleted and removes every consent and the epoch row', async () => {
		const t = harness();
		const now = Date.now();
		const user = await create(t, {
			model: 'user',
			data: {
				name: 'Leaving',
				email: 'leaving@example.test',
				emailVerified: true,
				createdAt: now,
				updatedAt: now
			}
		});
		const userId = String((user as { _id: string })._id);
		for (let index = 0; index < 130; index++) {
			await create(t, {
				model: 'oauthConsent',
				data: {
					clientId: `client-${index}`,
					userId,
					referenceId: '2',
					scopes: ['mcp:read']
				}
			});
		}
		await create(t, {
			model: 'oauthConsent',
			data: {
				clientId: 'client-0',
				userId: 'someone-else',
				referenceId: '0',
				scopes: ['mcp:read']
			}
		});
		await t.run((ctx) => ctx.db.insert('oauthGrantEpochs', { userId, epoch: 2 }));
		const onDeleteHandle = await t.run(() => createFunctionHandle(internal.auth.onDelete));

		await runToCompletion(t, () =>
			t.mutation(components.betterAuth.adapter.deleteOne, {
				input: { model: 'user', where: [{ field: '_id', value: userId }] },
				onDeleteHandle
			})
		);

		expect((await rows(t, 'oauthConsent')).map((row) => row.userId)).toEqual(['someone-else']);
		expect(await t.run((ctx) => ctx.db.query('oauthGrantEpochs').take(10))).toEqual([]);
	});
});

describe('a run without work', () => {
	it('schedules nothing', async () => {
		const t = harness();

		await t.mutation(internal.oauth.cleanup.deleteStaleClients, {});
		await t.mutation(internal.oauth.cleanup.deleteExpiredTokens, {});
		await t.mutation(internal.oauth.cleanup.eraseUserGrants, { userId: 'nobody' });

		expect(await scheduledJobs(t)).toBe(0);
	});
});
