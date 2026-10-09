import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onDelete } from '../../auth';
import { continueErasure, erasePage, startJourneyErasure } from './erasure';
import { createJourneyStore } from './journeyStore.fixtures';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };

const USER = 'user_deleted';
const OTHER = 'user_kept';

function setup() {
	return createJourneyStore({
		users: [OTHER],
		functions: {
			'admin/journey/erasure:erasePage': erasePage as unknown as Registered,
			'admin/journey/erasure:continueErasure': continueErasure as unknown as Registered
		}
	});
}

type Store = ReturnType<typeof setup>;

async function startErasure(store: Store) {
	await store.mutate((ctx) => startJourneyErasure(ctx as never, USER));
}

function advance(ms: number) {
	vi.setSystemTime(Date.now() + ms);
}

function seedContacts(store: Store, userId: string, count: number, searchText = '') {
	for (let i = 0; i < count; i++) {
		store.insert('supportThreads', {
			threadId: `${userId}_thread_${i}`,
			userId,
			status: 'open',
			createdAt: i,
			updatedAt: i,
			firstUserMessageAt: 1_000 + i,
			searchText
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(Date.UTC(2026, 9, 8, 12));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('journey erasure', () => {
	it('crosses a leading page of unmarked community messages and clears only the deleted user', async () => {
		const store = setup();
		for (let i = 0; i < 250; i++) store.insert('messages', { userId: USER, body: `old ${i}` });
		for (let i = 0; i < 30; i++) {
			store.insert('messages', { userId: USER, body: `kept ${i}`, quotaSettledAt: 5 });
		}
		store.insert('messages', { userId: OTHER, body: 'other', quotaSettledAt: 5 });

		await startErasure(store);
		await store.runDueJobs();

		const messages = store.docs('messages');
		expect(messages).toHaveLength(281);
		expect(messages.filter((m) => m.userId === USER && m.quotaSettledAt !== undefined)).toEqual([]);
		expect(messages.find((m) => m.userId === OTHER)?.quotaSettledAt).toBe(5);
		expect(store.jobs()).toEqual([]);
	});

	it('shrinks the support range to empty, large threads included, and keeps the threads', async () => {
		const store = setup();
		seedContacts(store, USER, 120);
		// Large threads make byte-limited pages shorter, not failed.
		seedContacts(store, USER, 4, 'x'.repeat(400_000));
		seedContacts(store, OTHER, 2);
		store.insert('supportThreads', {
			threadId: 'never_contacted',
			userId: USER,
			status: 'open',
			createdAt: 0,
			updatedAt: 0
		});

		await startErasure(store);
		await store.runDueJobs();

		const threads = store.docs('supportThreads');
		expect(threads).toHaveLength(127);
		expect(threads.filter((t) => t.userId === USER && t.firstUserMessageAt !== undefined)).toEqual(
			[]
		);
		expect(threads.filter((t) => t.userId === OTHER).map((t) => t.firstUserMessageAt)).toEqual([
			1_000, 1_001
		]);
	});

	// A full page cannot tell whether it took the last row. Support runs on its
	// own page because the community step already paginated in the first one.
	it.each([
		{
			step: 'receipts',
			pages: 1,
			seed: (store: Store) => {
				for (let i = 0; i < 500; i++) store.insert('aiChatMessageReceipts', { userId: USER });
			}
		},
		{
			step: 'community',
			pages: 1,
			seed: (store: Store) => {
				for (let i = 0; i < 200; i++) {
					store.insert('messages', { userId: USER, body: `kept ${i}`, quotaSettledAt: 5 });
				}
			}
		},
		{ step: 'support', pages: 2, seed: (store: Store) => seedContacts(store, USER, 50) },
		{
			step: 'byte-limited support',
			pages: 2,
			seed: (store: Store) => seedContacts(store, USER, 3, 'x'.repeat(100_000))
		}
	])('schedules nothing after a full last $step page', async ({ pages, seed }) => {
		const store = setup();
		seed(store);

		await startErasure(store);
		await store.runDueJobs();

		expect(store.docs('aiChatMessageReceipts')).toEqual([]);
		expect(store.docs('messages').filter((m) => m.quotaSettledAt !== undefined)).toEqual([]);
		expect(store.docs('supportThreads').filter((t) => t.firstUserMessageAt !== undefined)).toEqual(
			[]
		);
		expect(store.childCalls()).toHaveLength(pages);
	});

	it('erases support threads near the document size limit within the page budget', async () => {
		const store = setup();
		seedContacts(store, USER, 3, 'x'.repeat(900_000));

		await startErasure(store);
		await store.runDueJobs();

		expect(store.docs('supportThreads').filter((t) => t.firstUserMessageAt !== undefined)).toEqual(
			[]
		);
		expect(store.jobs()).toEqual([]);
	});

	it('does not scan or schedule a long history that was never settled', async () => {
		const store = setup();
		for (let i = 0; i < 201; i++) store.insert('messages', { userId: USER, body: `old ${i}` });
		seedContacts(store, USER, 1);

		await startErasure(store);

		expect(store.jobs().map((job) => job.args.step)).toEqual(['support']);
		expect(store.childCalls().map((call) => call.name)).toEqual([
			'admin/journey/erasure:erasePage'
		]);
	});

	it('deletes the receipts of the deleted user only', async () => {
		const store = setup();
		for (let i = 0; i < 1_100; i++) store.insert('aiChatMessageReceipts', { userId: USER });
		store.insert('aiChatMessageReceipts', { userId: OTHER });

		await startErasure(store);
		await store.runDueJobs();

		expect(store.docs('aiChatMessageReceipts').map((r) => r.userId)).toEqual([OTHER]);
	});

	it('progresses after one retry when a page fails once', async () => {
		const store = setup();
		const receipt = store.insert('aiChatMessageReceipts', { userId: USER });
		store.failWrites(receipt, 1);

		await startErasure(store);
		expect(store.jobs()).toEqual([
			{
				delayMs: 60_000,
				name: 'admin/journey/erasure:continueErasure',
				args: { userId: USER, step: 'receipts', attempt: 2 }
			}
		]);

		advance(60_000);
		await store.runDueJobs();

		expect(store.docs('aiChatMessageReceipts')).toEqual([]);
		expect(store.jobs()).toEqual([]);
	});

	it('stops after four attempts at a permanently failing item and resumes on a manual rerun', async () => {
		const store = setup();
		const stuck = store.insert('aiChatMessageReceipts', { userId: USER });
		store.insert('aiChatMessageReceipts', { userId: USER });
		store.failWrites(stuck);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const attempts: number[] = [];

		await startErasure(store);
		attempts.push(1);
		for (const delay of [60_000, 10 * 60_000, 60 * 60_000]) {
			const [job] = store.jobs();
			expect(job?.delayMs).toBe(delay);
			attempts.push(job?.args.attempt as number);
			advance(delay);
			await store.runDueJobs();
		}

		expect(attempts).toEqual([1, 2, 3, 4]);
		expect(store.jobs()).toEqual([]);
		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith({
			code: 'journey_erasure_blocked',
			step: 'receipts',
			userId: USER
		});
		expect(store.docs('aiChatMessageReceipts')).toHaveLength(2);

		store.clearFaults();
		await store.mutate(continueErasure as unknown as Registered, {
			userId: USER,
			step: 'receipts',
			attempt: 1
		});
		await store.runDueJobs();
		expect(store.docs('aiChatMessageReceipts')).toEqual([]);
	});

	it('schedules nothing for a user with nothing to erase', async () => {
		const store = setup();
		store.insert('messages', { userId: USER, body: 'never settled' });
		store.insert('supportThreads', {
			threadId: 'warm',
			userId: USER,
			status: 'open',
			createdAt: 0,
			updatedAt: 0
		});

		await startErasure(store);

		expect(store.jobs()).toEqual([]);
	});

	it('schedules only the step with work when only the last step has any', async () => {
		const store = setup();
		store.insert('messages', { userId: USER, body: 'never settled' });
		seedContacts(store, USER, 3);

		await startErasure(store);
		expect(store.jobs().map((job) => job.args.step)).toEqual(['support']);

		const ran = await store.runDueJobs();
		expect(ran).toEqual(['admin/journey/erasure:continueErasure']);
		expect(store.docs('supportThreads').some((t) => t.firstUserMessageAt !== undefined)).toBe(
			false
		);
	});
});

describe('account deletion trigger', () => {
	it('commits the deletion and rolls back a failed erasure page', async () => {
		const store = createJourneyStore({
			users: [USER, OTHER],
			functions: {
				'admin/journey/erasure:erasePage': erasePage as unknown as Registered,
				'admin/journey/erasure:continueErasure': continueErasure as unknown as Registered
			}
		});
		store.insert('passkeyNudgeDismissals', { userId: USER });
		const kept = store.insert('aiChatMessageReceipts', { userId: USER });
		const failing = store.insert('aiChatMessageReceipts', { userId: USER });
		store.insert('dashboardCounters', { totalUsers: 2, adminCount: 0, bannedCount: 0 });
		store.failWrites(failing);
		// The auth component removes the user, then runs this trigger.
		store.deleteUser(USER);

		await store.mutate(onDelete as unknown as Registered, {
			model: 'user',
			doc: { _id: USER, role: 'user', banned: false }
		});

		expect(store.docs('dashboardCounters')[0]?.totalUsers).toBe(1);
		expect(store.docs('passkeyNudgeDismissals')).toEqual([]);
		expect(
			store
				.docs('aiChatMessageReceipts')
				.map((receipt) => receipt._id)
				.sort()
		).toEqual([kept, failing].sort());
		expect(store.childCalls()).toEqual([
			{
				name: 'admin/journey/erasure:erasePage',
				limits: { documentsRead: 2000, bytesRead: 4 * 1024 * 1024, documentsWritten: 600 }
			}
		]);
		expect(store.jobs()).toEqual([
			{
				delayMs: 60_000,
				name: 'admin/journey/erasure:continueErasure',
				args: { userId: USER, step: 'receipts', attempt: 2 }
			}
		]);
	});
});
