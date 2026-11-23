// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { ADMIN_ERROR_CODES, createAdminError } from '../errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'query'>;

async function createUser(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { name: 'Ada', email, emailVerified: true, role, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const userId = await createUser(t, role, email);
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return { userId, caller: t.withIdentity({ subject: userId, sessionId: session._id }) };
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const page = { numItems: 10, cursor: null };
const unbounded = { numItems: Number.POSITIVE_INFINITY, cursor: null };

const calls = (caller: Caller) => [
	caller.query(api.admin.support.queries.getAwaitingResponseCount, {}),
	caller.query(api.admin.support.queries.getThreadForAdmin, { threadId: 'thread_1' }),
	caller.query(api.admin.support.queries.listAdmins, {}),
	caller.query(api.admin.support.queries.listInternalUserNotes, { userId: 'customer_1' }),
	caller.query(api.admin.support.queries.listMessageRoutesForAdmin, { threadId: 'thread_1' }),
	caller.query(api.admin.support.queries.listMessagesForAdmin, {
		threadId: 'thread_1',
		paginationOpts: page
	}),
	caller.query(api.admin.support.queries.listThreadsForAdmin, { filter: 'all' }),
	caller.query(api.admin.support.queries.listInternalUserNotes, {
		userId: 'customer_1',
		paginationOpts: unbounded
	}),
	caller.query(api.admin.support.queries.listMessagesForAdmin, {
		threadId: 'thread_1',
		paginationOpts: unbounded
	}),
	caller.query(api.admin.support.queries.listThreadsForAdmin, {
		filter: 'all',
		paginationOpts: unbounded
	})
];

async function seedThread(t: Harness, ownerId: string, assignedTo: string) {
	await t.run(async (ctx) => {
		await ctx.db.insert('supportThreads', {
			threadId: 'thread_1',
			userId: ownerId,
			status: 'open',
			isHandedOff: true,
			awaitingAdminResponse: true,
			assignedTo,
			createdAt: 1,
			updatedAt: 2,
			title: 'Refund'
		});
		await ctx.db.insert('supportMessageContexts', {
			threadId: 'thread_1',
			messageId: 'message_1',
			pageUrl: '/de/billing?tab=1',
			createdAt: 1
		});
		await ctx.db.insert('internalUserNotes', {
			userId: ownerId,
			adminUserId: assignedTo,
			content: 'Refunded March',
			createdAt: 3
		});
	});
}

describe('admin support queries access', () => {
	it('refuses an anonymous caller on every query', async () => {
		const t = harness();

		const refusals = await Promise.all(calls(t).map(refusal));

		expect(refusals).toEqual(Array(10).fill('Unauthenticated'));
	});

	it('refuses a signed-in non-admin on every query', async () => {
		const t = harness();
		const user = await signIn(t, 'user', 'user@example.com');

		const refusals = await Promise.all(calls(user.caller).map(refusal));

		expect(refusals).toEqual(
			Array(10).fill(createAdminError(ADMIN_ERROR_CODES.accessRequired).data)
		);
	});
});

describe('admin support queries as an admin', () => {
	it('serves the thread, its routes, the notes, the count and the admins', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const ownerId = await createUser(t, 'user', 'owner@example.com');
		await seedThread(t, ownerId, admin.userId);
		const { queries } = api.admin.support;

		const threads = await admin.caller.query(queries.listThreadsForAdmin, { filter: 'all' });
		expect(threads.isDone).toBe(true);
		expect(threads.page).toMatchObject([
			{
				_id: 'thread_1',
				_creationTime: 1,
				userId: ownerId,
				title: 'Refund',
				status: 'active',
				supportMetadata: { threadId: 'thread_1', assignedTo: admin.userId, updatedAt: 2 }
			}
		]);
		await expect(
			admin.caller.query(queries.getThreadForAdmin, { threadId: 'thread_1' })
		).resolves.toMatchObject({
			_id: 'thread_1',
			status: 'active',
			assignedAdmin: { id: admin.userId, email: 'admin@example.com', image: null },
			user: { id: ownerId, email: 'owner@example.com', image: null }
		});
		await expect(
			admin.caller.query(queries.listMessageRoutesForAdmin, { threadId: 'thread_1' })
		).resolves.toEqual([{ messageId: 'message_1', pageUrl: '/de/billing' }]);
		const notes = await admin.caller.query(queries.listInternalUserNotes, { userId: ownerId });
		expect(notes.page).toMatchObject([
			{ content: 'Refunded March', adminName: 'Ada', adminEmail: 'admin@example.com' }
		]);
		await expect(admin.caller.query(queries.getAwaitingResponseCount, {})).resolves.toBe(1);
		await expect(admin.caller.query(queries.listAdmins, {})).resolves.toEqual([
			{ id: admin.userId, name: 'Ada', email: 'admin@example.com', image: null }
		]);
	});

	it('filters the inbox by assignment and status', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const ownerId = await createUser(t, 'user', 'owner@example.com');
		await seedThread(t, ownerId, admin.userId);
		await t.run((ctx) =>
			ctx.db.insert('supportThreads', {
				threadId: 'thread_2',
				userId: 'anon_guest',
				status: 'done',
				isHandedOff: true,
				createdAt: 1,
				updatedAt: 3
			})
		);
		const list = async (args: {
			filter: 'all' | 'unassigned' | { assignedTo: string };
			status?: 'open' | 'done';
		}) =>
			(await admin.caller.query(api.admin.support.queries.listThreadsForAdmin, args)).page.map(
				(thread) => thread._id
			);
		const mine = { assignedTo: admin.userId };

		expect(await list({ filter: 'all' })).toEqual(['thread_2', 'thread_1']);
		expect(await list({ filter: 'unassigned' })).toEqual(['thread_2']);
		expect(await list({ filter: mine })).toEqual(['thread_1']);
		expect(await list({ filter: 'all', status: 'open' })).toEqual(['thread_1']);
		expect(await list({ filter: 'unassigned', status: 'done' })).toEqual(['thread_2']);
		expect(await list({ filter: mine, status: 'done' })).toEqual([]);
	});

	it('searches the inbox and continues a page from its cursor', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		await t.run(async (ctx) => {
			for (const [threadId, searchText, status, updatedAt] of [
				['thread_1', 'refund for march', 'open', 1],
				['thread_2', 'refund for april', 'done', 2],
				['thread_3', 'invoice address', 'open', 3]
			] as const) {
				await ctx.db.insert('supportThreads', {
					threadId,
					userId: 'anon_guest',
					status,
					isHandedOff: true,
					searchText,
					createdAt: 1,
					updatedAt
				});
			}
		});
		const { listThreadsForAdmin } = api.admin.support.queries;
		const ids = (result: { page: ReadonlyArray<{ _id: string }> }) =>
			result.page.map((thread) => thread._id);

		const first = await admin.caller.query(listThreadsForAdmin, {
			filter: 'all',
			paginationOpts: { numItems: 2, cursor: null }
		});
		const rest = await admin.caller.query(listThreadsForAdmin, {
			filter: 'all',
			paginationOpts: { numItems: 2, cursor: first.continueCursor }
		});
		expect([ids(first), ids(rest)]).toEqual([['thread_3', 'thread_2'], ['thread_1']]);

		const refunds = await admin.caller.query(listThreadsForAdmin, {
			filter: 'all',
			search: 'refund'
		});
		expect(ids(refunds).sort()).toEqual(['thread_1', 'thread_2']);
		const openRefunds = await admin.caller.query(listThreadsForAdmin, {
			filter: 'all',
			status: 'open',
			search: 'refund'
		});
		expect(ids(openRefunds)).toEqual(['thread_1']);
	});

	it('fails the thread details and the transcript of an unknown thread', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const { queries } = api.admin.support;
		const missing = 'Support thread not found for threadId: thread_missing';

		await expect(
			admin.caller.query(queries.getThreadForAdmin, { threadId: 'thread_missing' })
		).rejects.toThrow(missing);
		await expect(
			admin.caller.query(queries.listMessagesForAdmin, {
				threadId: 'thread_missing',
				paginationOpts: page
			})
		).rejects.toThrow(missing);
	});
});
