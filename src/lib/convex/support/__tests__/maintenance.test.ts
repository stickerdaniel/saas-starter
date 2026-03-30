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
		}
	},
	internal: {}
}));

import { authComponent } from '../../auth';
import { supportAgent } from '../agent';
import { migrateAnonymousTickets } from '../migration';
import { backfillThreadMetadata } from '../threads';

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

describe('support maintenance helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('backfills support denormalized fields from existing agent data', async () => {
		const collect = vi.fn().mockResolvedValue([
			{
				_id: 'support_doc_1',
				threadId: 'thread_1',
				userName: 'Ada',
				userEmail: 'ada@example.com'
			}
		]);
		const patch = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: {
				query: vi.fn(() => ({
					collect
				})),
				patch
			},
			runQuery: vi
				.fn()
				.mockResolvedValueOnce({
					_id: 'thread_1',
					title: 'Billing',
					summary: 'Upgrade issue'
				})
				.mockResolvedValueOnce({
					page: [
						{
							text: 'Latest support reply',
							_creationTime: 1234,
							agentName: 'Kai',
							message: { role: 'assistant' }
						}
					]
				})
		};

		const result = await backfillThreadMetadataHandler._handler(ctx, {});

		expect(result).toEqual({ updated: 1, total: 1 });
		expect(patch).toHaveBeenCalledWith('support_doc_1', {
			title: 'Billing',
			summary: 'Upgrade issue',
			lastMessage: 'Latest support reply',
			lastMessageAt: 1234,
			lastMessageRole: 'assistant',
			lastAgentName: 'Kai',
			searchText: 'billing | upgrade issue | latest support reply | ada | ada@example.com'
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
			notificationEmail: 'ada@example.com',
			updatedAt: expect.any(Number)
		});
		expect(patch).toHaveBeenNthCalledWith(2, 'support_doc_2', {
			userId: 'user_1',
			userName: 'Ada',
			userEmail: 'ada@example.com',
			notificationEmail: 'custom@example.com',
			updatedAt: expect.any(Number)
		});
		expect(deleteDoc).toHaveBeenCalledWith('support_doc_warm');
	});
});
