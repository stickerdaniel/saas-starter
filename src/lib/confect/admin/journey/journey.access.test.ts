// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../../../convex/_generated/api';
import * as erasure from '../../../convex/admin/journey/erasure';
import * as aiChat from '../../../convex/admin/journey/sources/aiChat';
import * as community from '../../../convex/admin/journey/sources/community';
import * as support from '../../../convex/admin/journey/sources/support';
import schema from '../../../convex/schema';
import { convexModules } from '../../convexTest.modules';

const USER = 'user_journey';
const DAY = 24 * 60 * 60 * 1000;

const visibility = (registered: object) => ({
	public: Reflect.get(registered, 'isPublic') === true,
	internal: Reflect.get(registered, 'isInternal') === true
});

async function seeded() {
	const t = convexTest(schema, convexModules);
	await t.run(async (ctx) => {
		for (const source of ['aiChat', 'community', 'support']) {
			await ctx.db.insert('journeyCaptureStarts', { source, startedAt: 1 });
		}
		await ctx.db.insert('aiChatMessageReceipts', { userId: USER });
		await ctx.db.insert('messages', { userId: USER, body: 'hello', quotaSettledAt: 5 });
		await ctx.db.insert('supportThreads', {
			threadId: 'thread_1',
			userId: USER,
			status: 'open',
			createdAt: 1,
			updatedAt: 1,
			firstUserMessageAt: Date.now()
		});
	});
	return t;
}

const counted = (count: number) => ({
	count,
	firstAt: count === 0 ? null : expect.any(Number),
	lastAt: count === 0 ? null : expect.any(Number),
	truncated: false
});

afterEach(() => {
	vi.useRealTimers();
});

describe('journey access', () => {
	it('registers the erasure pages and the three source reads as internal only', () => {
		const modules = { erasure, aiChat, community, support };
		expect(
			Object.fromEntries(
				Object.entries(modules).map(([module, functions]) => [
					module,
					Object.fromEntries(
						Object.entries(functions).map(([name, registered]) => [name, visibility(registered)])
					)
				])
			)
		).toEqual({
			erasure: {
				continueErasure: { public: false, internal: true },
				erasePage: { public: false, internal: true }
			},
			aiChat: { read: { public: false, internal: true } },
			community: { read: { public: false, internal: true } },
			support: { read: { public: false, internal: true } }
		});
	});

	it('serves the three source reads without identity', async () => {
		const t = await seeded();
		const now = Date.now();
		const request = {
			episode: 'new_customer' as const,
			userId: USER,
			signupAt: now - DAY,
			paymentAt: now + DAY,
			window: { start: now - DAY, end: now + 2 * DAY }
		};
		const capture = { kind: 'started', at: 1 };

		expect(await t.query(internal.admin.journey.sources.aiChat.read, request)).toEqual({
			coverage: { truncated: false, capture },
			before: counted(1),
			after: counted(0)
		});
		expect(await t.query(internal.admin.journey.sources.community.read, request)).toEqual({
			coverage: { truncated: false, capture },
			before: counted(1),
			after: counted(0)
		});
		expect(await t.query(internal.admin.journey.sources.support.read, request)).toEqual({
			coverage: { truncated: false, capture },
			contacts: [expect.any(Number)]
		});
	});

	it('runs both erasure functions without identity and schedules the next page', async () => {
		vi.useFakeTimers();
		const t = await seeded();
		const { erasePage, continueErasure } = internal.admin.journey.erasure;

		expect(await t.mutation(continueErasure, { userId: USER, step: 'ledger', attempt: 1 })).toBe(
			null
		);
		const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').take(10));
		expect(scheduled.map(({ name, args }) => [name, args])).toEqual([
			['admin/journey/erasure:continueErasure', [{ userId: USER, step: 'community', attempt: 1 }]]
		]);

		expect(await t.mutation(erasePage, { userId: USER, step: 'community' })).toEqual({
			step: 'support'
		});
		expect(await t.mutation(erasePage, { userId: USER, step: 'support' })).toBe(null);
		expect(
			await t.run(async (ctx) => ({
				receipts: await ctx.db.query('aiChatMessageReceipts').take(10),
				settled: (await ctx.db.query('messages').take(10)).map((m) => 'quotaSettledAt' in m),
				contacts: (await ctx.db.query('supportThreads').take(10)).map(
					(thread) => 'firstUserMessageAt' in thread
				)
			}))
		).toEqual({ receipts: [], settled: [false], contacts: [false] });
	});
});
