import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn()
	}
}));

vi.mock('../agent', () => ({
	supportAgent: {
		updateThreadMetadata: vi.fn(),
		deleteThreadAsync: vi.fn()
	}
}));

vi.mock('../../_generated/api', () => ({
	components: {
		agent: {
			threads: {
				getThread: 'components.agent.threads.getThread'
			},
			messages: {
				listMessagesByThreadId: 'components.agent.messages.listMessagesByThreadId'
			}
		},
		betterAuth: {
			adapter: {
				findOne: 'components.betterAuth.adapter.findOne'
			}
		}
	},
	internal: {}
}));

import { authComponent } from '../../auth';
import { supportAgent } from '../agent';
import { migrateAnonymousTickets } from '../migration';
import { backfillThreadMetadata, syncUserProfile } from '../threads';

const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;
const updateThreadMetadataMock = supportAgent.updateThreadMetadata as unknown as ReturnType<
	typeof vi.fn
>;
const deleteThreadAsyncMock = supportAgent.deleteThreadAsync as unknown as ReturnType<typeof vi.fn>;

type MutationHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const backfillThreadMetadataHandler = backfillThreadMetadata as unknown as MutationHandler<
	Record<string, never>,
	{ updated: number; total: number }
>;
const migrateAnonymousTicketsHandler = migrateAnonymousTickets as unknown as MutationHandler<
	{ anonymousUserId: string },
	{ migratedCount: number }
>;
const syncUserProfileHandler = syncUserProfile as unknown as MutationHandler<
	{ userId: string; userName?: string; userEmail?: string },
	null
>;

describe('support maintenance helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('backfills support denormalized fields from the live user profile', async () => {
		const collect = vi.fn().mockResolvedValue([
			{
				_id: 'support_doc_1',
				threadId: 'thread_1',
				userId: 'user_1',
				userName: 'Ada Old',
				userEmail: 'old@example.com'
			},
			{
				_id: 'support_doc_anon',
				threadId: 'thread_anon',
				userId: 'anon_123'
			}
		]);
		const patch = vi.fn().mockResolvedValue(undefined);
		const runQuery = vi.fn(async (ref: string, args: { threadId?: string }) => {
			if (ref === 'components.agent.threads.getThread') {
				return { _id: args.threadId, title: 'Billing', summary: 'Upgrade issue' };
			}
			if (ref === 'components.betterAuth.adapter.findOne') {
				return { name: 'Ada', email: 'ada@example.com' };
			}
			if (ref === 'components.agent.messages.listMessagesByThreadId') {
				return {
					page: [
						{
							text: 'Latest support reply',
							_creationTime: 1234,
							agentName: 'Kai',
							message: { role: 'assistant' }
						}
					]
				};
			}
			throw new Error(`Unexpected runQuery ref: ${ref}`);
		});
		const ctx = {
			db: {
				query: vi.fn(() => ({
					collect
				})),
				patch
			},
			runQuery
		};

		const result = await backfillThreadMetadataHandler._handler(ctx, {});

		expect(result).toEqual({ updated: 2, total: 2 });

		// Authenticated thread: stale denormalized values are replaced by the live profile
		expect(patch).toHaveBeenNthCalledWith(1, 'support_doc_1', {
			title: 'Billing',
			summary: 'Upgrade issue',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			lastMessage: 'Latest support reply',
			lastMessageAt: 1234,
			lastMessageRole: 'assistant',
			lastAgentName: 'Kai',
			searchText: 'billing | upgrade issue | latest support reply | ada | ada@example.com'
		});

		// Anonymous thread: no profile fetch, no identity in searchText
		expect(patch).toHaveBeenNthCalledWith(2, 'support_doc_anon', {
			title: 'Billing',
			summary: 'Upgrade issue',
			userName: undefined,
			userEmail: undefined,
			lastMessage: 'Latest support reply',
			lastMessageAt: 1234,
			lastMessageRole: 'assistant',
			lastAgentName: 'Kai',
			searchText: 'billing | upgrade issue | latest support reply'
		});

		const profileLookups = runQuery.mock.calls.filter(
			([ref]) => ref === 'components.betterAuth.adapter.findOne'
		);
		expect(profileLookups).toHaveLength(1);
		expect(profileLookups[0][1]).toEqual({
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: 'user_1' }],
			select: ['name', 'email']
		});
	});

	it('syncs denormalized profile fields across all threads of a user', async () => {
		const collect = vi.fn().mockResolvedValue([
			{
				_id: 'support_doc_1',
				title: 'Billing',
				summary: 'Upgrade issue',
				lastMessage: 'Latest support reply',
				userName: 'Ada Old',
				userEmail: 'old@example.com',
				notificationEmail: 'custom@example.com',
				updatedAt: 1000
			},
			{
				_id: 'support_doc_2',
				userName: 'Ada Old',
				userEmail: 'old@example.com'
			}
		]);
		const withIndex = vi.fn(() => ({ collect }));
		const patch = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: {
				query: vi.fn(() => ({ withIndex })),
				patch
			}
		};

		const result = await syncUserProfileHandler._handler(ctx, {
			userId: 'user_1',
			userName: 'Ada New',
			userEmail: 'new@example.com'
		});

		expect(result).toBeNull();
		// Exact patch objects: notificationEmail and updatedAt are intentionally untouched
		expect(patch).toHaveBeenNthCalledWith(1, 'support_doc_1', {
			userName: 'Ada New',
			userEmail: 'new@example.com',
			searchText: 'billing | upgrade issue | latest support reply | ada new | new@example.com'
		});
		expect(patch).toHaveBeenNthCalledWith(2, 'support_doc_2', {
			userName: 'Ada New',
			userEmail: 'new@example.com',
			searchText: 'ada new | new@example.com'
		});
	});

	it('migrates only supportThreads for an anonymous user', async () => {
		getAuthUserMock.mockResolvedValue({
			_id: 'user_1',
			name: 'Ada',
			email: 'ada@example.com'
		});

		const collect = vi.fn().mockResolvedValue([
			{
				_id: 'support_doc_1',
				threadId: 'thread_support_1',
				title: 'Billing',
				summary: 'Upgrade issue',
				lastMessage: 'Anon message',
				notificationEmail: undefined
			},
			{
				_id: 'support_doc_warm',
				threadId: 'thread_support_warm',
				isWarm: true,
				notificationEmail: undefined
			},
			{
				_id: 'support_doc_2',
				threadId: 'thread_support_2',
				notificationEmail: 'custom@example.com'
			}
		]);
		const patch = vi.fn().mockResolvedValue(undefined);
		const deleteDoc = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: {
				query: vi.fn(() => ({
					withIndex: vi.fn(() => ({
						collect
					}))
				})),
				patch,
				delete: deleteDoc
			}
		};

		const result = await migrateAnonymousTicketsHandler._handler(ctx, {
			anonymousUserId: 'anon_123'
		});

		expect(result).toEqual({ migratedCount: 2 });
		expect(deleteThreadAsyncMock).toHaveBeenCalledWith(ctx, {
			threadId: 'thread_support_warm'
		});
		expect(patch).not.toHaveBeenCalledWith('support_doc_warm', expect.anything());
		expect(updateThreadMetadataMock).toHaveBeenCalledTimes(2);
		expect(updateThreadMetadataMock).toHaveBeenNthCalledWith(1, ctx, {
			threadId: 'thread_support_1',
			patch: { userId: 'user_1' }
		});
		expect(updateThreadMetadataMock).toHaveBeenNthCalledWith(2, ctx, {
			threadId: 'thread_support_2',
			patch: { userId: 'user_1' }
		});
		expect(patch).toHaveBeenNthCalledWith(1, 'support_doc_1', {
			userId: 'user_1',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			searchText: 'billing | upgrade issue | anon message | ada | ada@example.com',
			notificationEmail: 'ada@example.com',
			updatedAt: expect.any(Number)
		});
		expect(patch).toHaveBeenNthCalledWith(2, 'support_doc_2', {
			userId: 'user_1',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			searchText: 'ada | ada@example.com',
			notificationEmail: 'custom@example.com',
			updatedAt: expect.any(Number)
		});
		expect(deleteDoc).toHaveBeenCalledWith('support_doc_warm');
	});
});
