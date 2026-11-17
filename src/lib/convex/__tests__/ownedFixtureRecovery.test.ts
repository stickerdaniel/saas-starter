// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import { convexModules } from '../convexTest.modules';
import schema from '../schema';

// E2E teardown recovers a killed worker's fixtures by the token it registered
// before the seed. Recovery must reach every row of that token and nothing else,
// because the same user ID can also own genuine rows.
const secret = 'test-secret';
const token = (n: number) => `e2e-fixture-0000000${n}-0000-4000-8000-000000000000`;
const absent = {
	secret,
	userEmails: [],
	recipientEmails: [],
	supportOwners: [],
	supportThreadIds: []
};

beforeEach(() => vi.stubEnv('AUTH_E2E_TEST_SECRET', secret));
afterEach(() => vi.unstubAllEnvs());

describe('owned fixture recovery', () => {
	it('deletes the audit rows of one token and keeps other rows of the same fixture id', async () => {
		const t = convexTest(schema, convexModules);
		const fixtureId = 'fixture-user';
		for (const fixtureToken of [token(1), token(2)])
			await t.mutation(api.tests.seedAuditLogRows, {
				secret,
				fixtureToken,
				fixtureId,
				count: 21,
				offset: 0
			});
		await t.run((ctx) =>
			ctx.db.insert('adminAuditLogs', {
				adminUserId: fixtureId,
				targetUserId: fixtureId,
				action: 'ban_user',
				timestamp: 1,
				metadata: { reason: `${token(1)} quoted by a real admin` }
			})
		);
		const fixture = { kind: 'auditLog' as const, token: token(1), fixtureId };

		expect(await t.mutation(api.tests.deleteOwnedFixture, { secret, fixture })).toEqual({
			deleted: 21
		});
		expect(await t.run((ctx) => ctx.db.query('adminAuditLogs').take(100))).toHaveLength(22);
		const remains = await t.query(api.tests.findOwnedTestData, {
			...absent,
			fixtures: [fixture, { ...fixture, token: token(2) }]
		});
		expect(remains.fixtureTokens).toEqual([token(2)]);
	});

	it('deletes the history rows under one token prefix only', async () => {
		const t = convexTest(schema, convexModules);
		for (const fixtureToken of [token(1), token(2)])
			await t.mutation(api.tests.seedAiChatHistoryRows, {
				secret,
				fixtureToken,
				userId: 'user',
				rows: [1, 2, 3].map((n) => ({ threadId: `${fixtureToken}-${n}`, createdAt: n }))
			});
		const fixture = { kind: 'aiChatHistory' as const, token: token(1) };

		expect(await t.mutation(api.tests.deleteOwnedFixture, { secret, fixture })).toEqual({
			deleted: 3
		});
		const left = await t.run((ctx) => ctx.db.query('aiChatThreads').take(100));
		expect(left.map((row) => row.threadId).sort()).toEqual(
			[1, 2, 3].map((n) => `${token(2)}-${n}`)
		);
		await expect(
			t.mutation(api.tests.seedAiChatHistoryRows, {
				secret,
				fixtureToken: token(1),
				userId: 'user',
				rows: [{ threadId: 'unowned-thread', createdAt: 1 }]
			})
		).rejects.toThrow('must start with the fixture token');
	});

	it('deletes the synthetic notification of its token and rejects a malformed token', async () => {
		const t = convexTest(schema, convexModules);
		await t.mutation(api.tests.seedSupportNotificationClaim, { secret, fixtureToken: token(1) });
		const fixture = { kind: 'supportNotification' as const, token: token(1) };

		expect(await t.mutation(api.tests.deleteOwnedFixture, { secret, fixture })).toEqual({
			deleted: 1
		});
		expect(
			(await t.query(api.tests.findOwnedTestData, { ...absent, fixtures: [fixture] })).fixtureTokens
		).toEqual([]);
		await expect(
			t.mutation(api.tests.deleteOwnedFixture, {
				secret,
				fixture: { kind: 'aiChatHistory', token: '' }
			})
		).rejects.toThrow('Invalid E2E fixture token');
	});
});
