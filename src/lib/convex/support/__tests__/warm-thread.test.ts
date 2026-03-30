import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: {
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../agent', () => ({
	supportAgent: {
		createThread: vi.fn()
	}
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

import { authComponent } from '../../auth';
import { supportAgent } from '../agent';
import { getOrCreateWarmThread } from '../threads';

const safeGetAuthUserMock = authComponent.safeGetAuthUser as unknown as ReturnType<typeof vi.fn>;
const createThreadMock = supportAgent.createThread as unknown as ReturnType<typeof vi.fn>;

type MutationHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getOrCreateWarmThreadHandler = getOrCreateWarmThread as unknown as MutationHandler<
	{ anonymousUserId?: string; pageUrl?: string },
	{ threadId: string; notificationEmail?: string }
>;

describe('support warm thread acquisition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reuses an existing warm thread for the same anonymous owner', async () => {
		safeGetAuthUserMock.mockResolvedValue(undefined);

		const patch = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: {
				query: vi.fn(() => ({
					withIndex: vi.fn(() => ({
						first: vi.fn().mockResolvedValue({
							_id: 'support_doc_1',
							threadId: 'thread_warm_1',
							userId: 'anon_123',
							isWarm: true,
							pageUrl: 'https://example.com/old',
							notificationEmail: undefined
						})
					}))
				})),
				patch
			}
		};

		const result = await getOrCreateWarmThreadHandler._handler(ctx, {
			anonymousUserId: 'anon_123',
			pageUrl: 'https://example.com/new'
		});

		expect(result).toEqual({
			threadId: 'thread_warm_1',
			notificationEmail: undefined
		});
		expect(createThreadMock).not.toHaveBeenCalled();
		expect(patch).toHaveBeenCalledWith('support_doc_1', {
			pageUrl: 'https://example.com/new',
			updatedAt: expect.any(Number)
		});
	});

	it('creates a new warm thread for an anonymous owner when none exists', async () => {
		safeGetAuthUserMock.mockResolvedValue(undefined);
		createThreadMock.mockResolvedValue({ threadId: 'thread_warm_2' });

		const insert = vi.fn().mockResolvedValue('support_doc_2');
		const ctx = {
			db: {
				query: vi.fn(() => ({
					withIndex: vi.fn(() => ({
						first: vi.fn().mockResolvedValue(null)
					}))
				})),
				insert
			}
		};

		const result = await getOrCreateWarmThreadHandler._handler(ctx, {
			anonymousUserId: 'anon_456',
			pageUrl: 'https://example.com/support'
		});

		expect(result).toEqual({
			threadId: 'thread_warm_2',
			notificationEmail: undefined
		});
		expect(createThreadMock).toHaveBeenCalledWith(ctx, {
			userId: 'anon_456',
			title: 'Customer Support',
			summary: 'New support conversation'
		});
		expect(insert).toHaveBeenCalledWith(
			'supportThreads',
			expect.objectContaining({
				threadId: 'thread_warm_2',
				userId: 'anon_456',
				isWarm: true,
				awaitingAdminResponse: false,
				pageUrl: 'https://example.com/support'
			})
		);
	});
});
