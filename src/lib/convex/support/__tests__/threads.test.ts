import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ownership', () => ({
	getSupportOwnerIdentity: vi.fn(),
	requireSupportOwnerIdentity: vi.fn(),
	requireSupportThreadAccess: vi.fn(),
	requireSupportThreadRecord: vi.fn()
}));

vi.mock('../agent', () => ({
	supportAgent: {}
}));

vi.mock('../rateLimit', () => ({
	supportRateLimiter: {}
}));

vi.mock('../../_generated/api', () => ({
	components: {
		betterAuth: {
			adapter: {
				findOne: 'components.betterAuth.adapter.findOne'
			}
		},
		agent: {
			messages: {
				listMessagesByThreadId: 'components.agent.messages.listMessagesByThreadId'
			}
		}
	},
	internal: {}
}));

import { getSupportOwnerIdentity } from '../ownership';
import { listThreads } from '../threads';

const getSupportOwnerIdentityMock = getSupportOwnerIdentity as unknown as ReturnType<typeof vi.fn>;

type QueryHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listThreadsHandler = listThreads as unknown as QueryHandler<
	{ anonymousUserId?: string; paginationOpts?: { numItems: number; cursor: string | null } },
	{ page: Array<{ _id: string }>; isDone: boolean; continueCursor: string }
>;

describe('customer support thread ordering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSupportOwnerIdentityMock.mockResolvedValue({
			ownerId: 'user_1',
			isAnonymous: false
		});
	});

	it('paginates and returns threads in last-message index order', async () => {
		const paginationOpts = { numItems: 20, cursor: 'cursor_1' };
		// Convex has already ordered this page by lastMessageAt. The conflicting
		// updatedAt values catch any page-local re-sort before it reaches the UI.
		const indexedThreads = [
			{
				_id: 'support_doc_1',
				threadId: 'thread_first',
				createdAt: 1,
				userId: 'user_1',
				status: 'open' as const,
				updatedAt: 10,
				lastMessageAt: 100,
				isWarm: false
			},
			{
				_id: 'support_doc_2',
				threadId: 'thread_second',
				createdAt: 2,
				userId: 'user_1',
				status: 'open' as const,
				updatedAt: 100,
				lastMessageAt: 10,
				isWarm: false
			}
		];
		const paginate = vi.fn().mockResolvedValue({
			page: indexedThreads,
			isDone: false,
			continueCursor: 'cursor_2'
		});
		const order = vi.fn(() => ({ paginate }));
		const withIndex = vi.fn((_indexName, indexQuery) => {
			const eq = vi.fn(() => ({}));
			indexQuery({ eq });
			expect(eq).toHaveBeenCalledWith('userId', 'user_1');
			return { order };
		});
		const ctx = {
			db: {
				query: vi.fn(() => ({ withIndex }))
			},
			runQuery: vi.fn()
		};

		const result = await listThreadsHandler._handler(ctx, { paginationOpts });

		expect(withIndex).toHaveBeenCalledWith('by_user_and_last_message', expect.any(Function));
		expect(order).toHaveBeenCalledWith('desc');
		expect(paginate).toHaveBeenCalledWith(paginationOpts);
		expect(result.page.map((thread) => thread._id)).toEqual(['thread_first', 'thread_second']);
		expect(result).toMatchObject({ isDone: false, continueCursor: 'cursor_2' });
	});
});
