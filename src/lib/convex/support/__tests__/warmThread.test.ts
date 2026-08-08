import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../rateLimit', () => ({
	supportRateLimiter: {
		limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 })
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
import { supportRateLimiter } from '../rateLimit';
import { getOrCreateWarmThread } from '../threads';

const safeGetAuthUserMock = authComponent.safeGetAuthUser as unknown as ReturnType<typeof vi.fn>;
const createThreadMock = supportAgent.createThread as unknown as ReturnType<typeof vi.fn>;
const limitMock = supportRateLimiter.limit as unknown as ReturnType<typeof vi.fn>;

type MutationHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getOrCreateWarmThreadHandler = getOrCreateWarmThread as unknown as MutationHandler<
	{ anonymousUserId?: string; pageUrl?: string },
	{ threadId: string; notificationEmail?: string }
>;

/** Minimal ctx whose warm-thread lookup misses, so creation runs. */
function makeCreatingCtx(insert: ReturnType<typeof vi.fn>) {
	return {
		db: {
			query: vi.fn(() => ({
				withIndex: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) }))
			})),
			insert
		}
	};
}

describe('support warm thread acquisition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
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
		// The reuse branch must not consume a rate-limit token, otherwise
		// warm-thread polling would drain the thread-creation bucket
		expect(limitMock).not.toHaveBeenCalled();
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
		// The creation branch is rate limited; anonymous callers share a global bucket
		expect(limitMock).toHaveBeenCalledWith(ctx, 'supportThreadCreateAnon', {
			key: 'anonymous-global'
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

	it('opens a thread in agent mode by default', async () => {
		safeGetAuthUserMock.mockResolvedValue(undefined);
		createThreadMock.mockResolvedValue({ threadId: 'thread_warm_3' });
		const insert = vi.fn().mockResolvedValue('support_doc_3');

		await getOrCreateWarmThreadHandler._handler(makeCreatingCtx(insert), {
			anonymousUserId: 'anon_789'
		});

		expect(insert).toHaveBeenCalledWith(
			'supportThreads',
			expect.objectContaining({ isHandedOff: false })
		);
	});

	it('opens a thread handed off when the support AI is switched off', async () => {
		vi.stubEnv('SUPPORT_AI_ENABLED', 'false');
		safeGetAuthUserMock.mockResolvedValue(undefined);
		createThreadMock.mockResolvedValue({ threadId: 'thread_warm_4' });
		const insert = vi.fn().mockResolvedValue('support_doc_4');

		await getOrCreateWarmThreadHandler._handler(makeCreatingCtx(insert), {
			anonymousUserId: 'anon_012'
		});

		expect(insert).toHaveBeenCalledWith(
			'supportThreads',
			expect.objectContaining({ isHandedOff: true })
		);
	});
});
