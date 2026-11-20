// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';
import { getConvexErrorCode, getConvexErrorData } from '../utils/convex-errors';
import { api, components, internal } from './_generated/api';
import authSchema from './betterAuth/schema';
import { convexModules, preloadModules } from './convexTest.modules';
import { RegisteredFunction } from '@confect/server';
import { MixedScheduler } from 'effect/Scheduler';
import { SpikeDefect } from './effectSpike/probes';
import schema from './schema';

vi.mock('@gilhrpenner/convex-files-control', () => ({ registerRoutes: () => {} }));
vi.hoisted(() => vi.stubEnv('RESEND_API_KEY', 're_test'));

const betterAuthModules = await preloadModules(import.meta.glob('./betterAuth/**/*.ts'));
const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

const DAY_MS = 24 * 60 * 60 * 1000;

async function createUser(t: Harness, data: { name: string; email: string; role?: string }) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: { model: 'user', data: { emailVerified: true, createdAt: now, updatedAt: now, ...data } }
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, userId: string) {
	const now = Date.now();
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + DAY_MS,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return t.withIdentity({ subject: userId, sessionId: session._id });
}

/**
 * Runs `invoke` the way Convex runs a query or mutation: a timer the handler
 * requests never fires, and the request fails the invocation. Node's
 * `setImmediate` is the timer Effect's default scheduler picks here; convex-test
 * already rejects `setTimeout` inside transactions.
 */
async function withoutTimers<T>(invoke: () => Promise<T>): Promise<T> {
	const realSetImmediate = globalThis.setImmediate;
	let fail: (error: Error) => void = () => {};
	const requested = new Promise<never>((_, reject) => {
		fail = reject;
	});
	globalThis.setImmediate = (() => {
		fail(new Error('timer requested inside a Convex transaction'));
		return realSetImmediate(() => {});
	}) as unknown as typeof setImmediate;
	try {
		return await Promise.race([invoke(), requested]);
	} finally {
		globalThis.setImmediate = realSetImmediate;
	}
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('expected a rejection');
}

describe('item 1: the three handlers match their plain originals', () => {
	it('authedQuery returns the same dismissal', async () => {
		const t = harness();
		const userId = await createUser(t, { name: 'Ada', email: 'ada@example.com' });
		await t.run((ctx) => ctx.db.insert('passkeyNudgeDismissals', { userId, deferredUntil: 1_234 }));
		const asUser = await signIn(t, userId);
		const plain = await asUser.query(api.users.getPasskeyNudgeDismissal, {});
		const effect = await withoutTimers(() =>
			asUser.query(api.effectSpike.users.passkeyNudgeDismissal, {})
		);
		expect(effect).toBe(1_234);
		expect(effect).toBe(plain);
	});

	it('adminMutation writes the same role, counter, preference and audit row', async () => {
		const run = async (fn: typeof api.admin.mutations.setUserRole) => {
			const t = harness();
			const adminId = await createUser(t, { name: 'Sam', email: 'sam@example.com', role: 'admin' });
			const userId = await createUser(t, { name: 'Ada', email: 'ada@example.com' });
			const asAdmin = await signIn(t, adminId);
			const result = await withoutTimers(() => asAdmin.mutation(fn, { userId, role: 'admin' }));
			const state = await t.run(async (ctx) => ({
				prefs: (await ctx.db.query('adminNotificationPreferences').take(100)).map((p) => ({
					email: p.email,
					isAdminUser: p.isAdminUser
				})),
				audit: (await ctx.db.query('adminAuditLogs').take(100)).map((row) => ({
					action: row.action,
					metadata: row.metadata
				})),
				adminDelta: (await ctx.db.query('dashboardCounters').take(100)).reduce(
					(sum, row) => sum + row.adminCount,
					0
				)
			}));
			const role = (
				(await t.query(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: userId }]
				})) as { role?: string }
			).role;
			return { result, role, ...state };
		};
		const plain = await run(api.admin.mutations.setUserRole);
		const effect = await run(
			api.effectSpike.adminMutations
				.setUserRole as unknown as typeof api.admin.mutations.setUserRole
		);
		expect(effect.role).toBe('admin');
		expect(effect).toEqual(plain);
	});

	it('internalMutation schedules runPage as the plain one does', async () => {
		const run = async (fn: typeof internal.aiChat.activityMigration.start) => {
			const t = harness();
			await t.run((ctx) =>
				ctx.db.insert('aiChatThreads', { threadId: 'th_1', userId: 'u_1', createdAt: 1 })
			);
			const result = await withoutTimers(() => t.mutation(fn, { restart: true }));
			const scheduled = await t.run(async (ctx) =>
				(await ctx.db.system.query('_scheduled_functions').take(100)).map((job) => ({
					name: job.name,
					kind: job.state.kind
				}))
			);
			const migration = await t.run((ctx) => ctx.db.query('aiChatHistoryMigration').unique());
			return { result, scheduled, linked: migration?.scheduledFnId !== undefined };
		};
		const plain = await run(internal.aiChat.activityMigration.start);
		const effect = await run(
			internal.effectSpike.activityMigration
				.startActivityMigration as unknown as typeof internal.aiChat.activityMigration.start
		);
		expect(effect.scheduled).toEqual([
			{ name: 'aiChat/activityMigration:runPage', kind: 'pending' }
		]);
		expect(effect).toEqual(plain);
	});

	it('httpAction maps its own failure and leaves no ConvexError codec in the way', async () => {
		const t = harness();
		const ok = await t.fetch('/effect-spike/echo?mode=ok');
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ ok: true, mode: 'ok' });
		const refused = await t.fetch('/effect-spike/echo?mode=refuse');
		expect(refused.status).toBe(409);
		expect(await refused.json()).toEqual({ ok: false, reason: 'mode=refuse' });
		const defect = await rejection(t.fetch('/effect-spike/echo?mode=defect'));
		expect(defect).toBeInstanceOf(SpikeDefect);
	});
});

describe('item 2: yield stress', () => {
	it('3,000 Effect.succeed steps auto-yield on the sync scheduler in a query and a mutation', async () => {
		const t = harness();
		for (const fn of [
			internal.effectSpike.probes.stressQuery,
			internal.effectSpike.probes.stressMutation
		]) {
			const result = await withoutTimers(() =>
				fn === internal.effectSpike.probes.stressQuery
					? t.query(internal.effectSpike.probes.stressQuery, {})
					: t.mutation(internal.effectSpike.probes.stressMutation, {})
			);
			expect(result).toEqual({ items: 3_000, autoYielded: true });
		}
	});

	it('a 500-document read: one step per document stays under the budget, a traced Effect.fn step auto-yields', async () => {
		const t = harness();
		await t.mutation(internal.effectSpike.seed.seedMessages, { count: 500, userId: 'u_1' });
		expect(
			await withoutTimers(() =>
				t.query(internal.effectSpike.probes.readStressQuery, { limit: 500, perDoc: 'succeed' })
			)
		).toEqual({ items: 500, autoYielded: false });
		expect(
			await withoutTimers(() =>
				t.query(internal.effectSpike.probes.readStressQuery, { limit: 500, perDoc: 'traced' })
			)
		).toEqual({ items: 500, autoYielded: true });
	});

	it('control: the same programs on the default scheduler fail under the timer ban', async () => {
		// One harness per call: convex-test serializes transactions, and an
		// abandoned one keeps the lock.
		await expect(
			withoutTimers(() =>
				harness().query(internal.effectSpike.probes.stressQueryDefaultScheduler, {})
			)
		).rejects.toThrow('timer requested inside a Convex transaction');
		await expect(
			withoutTimers(() =>
				harness().mutation(internal.effectSpike.probes.stressMutationDefaultScheduler, {})
			)
		).rejects.toThrow('timer requested inside a Convex transaction');
		const t = harness();
		await t.mutation(internal.effectSpike.seed.seedMessages, { count: 500, userId: 'u_1' });
		expect(
			await withoutTimers(() =>
				t.query(internal.effectSpike.probes.readStressQueryDefaultScheduler, {
					limit: 500,
					perDoc: 'succeed'
				})
			)
		).toEqual({ items: 500, autoYielded: false });
		await expect(
			withoutTimers(() =>
				t.query(internal.effectSpike.probes.readStressQueryDefaultScheduler, {
					limit: 500,
					perDoc: 'traced'
				})
			)
		).rejects.toThrow('timer requested inside a Convex transaction');
	});
});

describe('item 3: errors', () => {
	it('a declared error keeps data.code and the client branch', async () => {
		const t = harness();
		const adminId = await createUser(t, { name: 'Sam', email: 'sam@example.com', role: 'admin' });
		const asAdmin = await signIn(t, adminId);
		const plain = await rejection(
			asAdmin.mutation(api.admin.mutations.setUserRole, { userId: adminId, role: 'user' })
		);
		const effect = await rejection(
			asAdmin.mutation(api.effectSpike.adminMutations.setUserRole, {
				userId: adminId,
				role: 'user'
			})
		);
		expect(getConvexErrorCode(effect)).toBe('ADMIN_CANNOT_CHANGE_OWN_ROLE');
		expect(getConvexErrorData(effect)).toEqual(getConvexErrorData(plain));
		const missing = await rejection(
			asAdmin.mutation(api.effectSpike.adminMutations.setUserRole, {
				userId: 'missing',
				role: 'admin'
			})
		);
		expect(getConvexErrorData(missing)).toEqual({ code: 'ADMIN_USER_NOT_FOUND' });
	});

	it('a native ConvexError from called code passes through', async () => {
		const t = harness();
		const error = await rejection(
			t.query(internal.effectSpike.probes.passthroughQuery, { userId: 'u_9' })
		);
		expect(getConvexErrorData(error)).toEqual({ code: 'ADMIN_USER_NOT_FOUND', userId: 'u_9' });
	});

	it('the pre-handler refusals stay unchanged', async () => {
		const t = harness();
		const plainAnon = await rejection(t.query(api.users.getPasskeyNudgeDismissal, {}));
		const effectAnon = await rejection(t.query(api.effectSpike.users.passkeyNudgeDismissal, {}));
		expect(String(effectAnon)).toBe(String(plainAnon));
		expect(getConvexErrorData(effectAnon)).toEqual(getConvexErrorData(plainAnon));
		expect(String(effectAnon)).toContain('Unauthenticated');

		const userId = await createUser(t, { name: 'Ada', email: 'ada@example.com' });
		const asUser = await signIn(t, userId);
		const plainRefusal = await rejection(
			asUser.mutation(api.admin.mutations.setUserRole, { userId, role: 'admin' })
		);
		const effectRefusal = await rejection(
			asUser.mutation(api.effectSpike.adminMutations.setUserRole, { userId, role: 'admin' })
		);
		expect(getConvexErrorData(effectRefusal)).toEqual({ code: 'ADMIN_ACCESS_REQUIRED' });
		expect(getConvexErrorData(effectRefusal)).toEqual(getConvexErrorData(plainRefusal));
	});

	it('a defect stays a defect: the same object, no public data', async () => {
		const defect = new SpikeDefect('direct');
		await expect(
			RegisteredFunction.runHandlerPromise(undefined, { scheduler: new MixedScheduler('sync') })(
				Effect.die(defect)
			)
		).rejects.toBe(defect);

		const t = harness();
		const error = await rejection(t.query(internal.effectSpike.probes.defectQuery, {}));
		expect(error).toBeInstanceOf(SpikeDefect);
		expect(getConvexErrorData(error)).toBeUndefined();
		expect(String(error)).not.toMatch(/FiberFailure/);
	});
});

describe('item 4: query clock', () => {
	it('logging and spans read no time; an explicit Clock read does; the live clock control does', async () => {
		const t = harness();
		const ambient = await t.query(internal.effectSpike.probes.clockProbeQuery, {
			explicit: false,
			live: false
		});
		expect(ambient.ambientCalls).toBeGreaterThan(0);
		expect(ambient).toMatchObject({ dateNowCalls: 0, ambientNonZero: 0, explicitTime: null });

		const explicit = await t.query(internal.effectSpike.probes.clockProbeQuery, {
			explicit: true,
			live: false
		});
		expect(explicit.dateNowCalls).toBe(1);
		expect(explicit.explicitTime).toBeGreaterThan(0);

		const live = await t.query(internal.effectSpike.probes.clockProbeQuery, {
			explicit: false,
			live: true
		});
		expect(live.dateNowCalls).toBeGreaterThan(0);
		expect(live.ambientNonZero).toBe(live.ambientCalls);
	});
});
