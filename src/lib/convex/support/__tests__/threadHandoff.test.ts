import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThreadLifecycleModule from '../threadLifecycle';

vi.mock('../ownership', () => ({
	getSupportOwnerIdentity: vi.fn(),
	requireSupportOwnerIdentity: vi.fn(),
	requireSupportThreadAccess: vi.fn(),
	requireSupportThreadRecord: vi.fn()
}));

// Journey capture is covered by its own tests; these stay on their concern.
vi.mock('../../admin/journey/capture', () => ({ ensureCaptureStart: vi.fn() }));

vi.mock('../agent', () => ({
	supportAgent: { saveMessage: vi.fn() }
}));

vi.mock('../rateLimit', () => ({
	ANONYMOUS_GLOBAL_RATE_LIMIT_KEY: 'anonymous-global',
	supportRateLimiter: {}
}));

vi.mock('../threadLifecycle', async () => {
	const actual = await vi.importActual<typeof ThreadLifecycleModule>('../threadLifecycle');
	return { ...actual, syncSupportLastMessage: vi.fn() };
});

vi.mock('../../_generated/api', () => ({
	components: {
		betterAuth: { adapter: { findOne: 'components.betterAuth.adapter.findOne' } },
		agent: {
			messages: { listMessagesByThreadId: 'components.agent.messages.listMessagesByThreadId' }
		}
	},
	internal: {
		admin: {
			support: {
				notifications: {
					getRecentUserMessages: 'internal.admin.support.notifications.getRecentUserMessages',
					scheduleAdminNotification:
						'internal.admin.support.notifications.scheduleAdminNotification'
				}
			}
		}
	}
}));

import { requireSupportThreadRecord } from '../ownership';
import { supportAgent } from '../agent';
import { updateThreadHandoff } from '../threads';

const requireRecordMock = requireSupportThreadRecord as unknown as ReturnType<typeof vi.fn>;
const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;

const handoffHandler = updateThreadHandoff as unknown as {
	_handler: (
		ctx: unknown,
		args: { threadId: string; anonymousUserId?: string; pageUrl?: string }
	) => Promise<boolean>;
};

function makeCtx() {
	return {
		db: { insert: vi.fn(), patch: vi.fn() },
		runQuery: vi.fn().mockResolvedValue(['handoff_message_42']),
		scheduler: { runAfter: vi.fn() }
	};
}

describe('updateThreadHandoff route metadata', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireRecordMock.mockResolvedValue({
			owner: { ownerId: 'anon_123', isAnonymous: true },
			supportThread: { _id: 'support_1', threadId: 'thread_1', isHandedOff: false, pageUrl: '/' }
		});
		saveMessageMock
			.mockResolvedValueOnce({ messageId: 'handoff_message_42' })
			.mockResolvedValueOnce({ messageId: 'assistant_message_1' });
	});

	// The request for a person is a customer message like any other, and it is
	// often the first one written after the visitor moved to the page in question.
	it('records the current route against the saved request message id', async () => {
		const ctx = makeCtx();

		await handoffHandler._handler(ctx, {
			threadId: 'thread_1',
			anonymousUserId: 'anon_123',
			pageUrl: 'https://example.com/fr/app/settings?tab=billing#plan'
		});

		expect(ctx.db.insert).toHaveBeenCalledWith('supportMessageContexts', {
			threadId: 'thread_1',
			messageId: 'handoff_message_42',
			pageUrl: '/fr/app/settings',
			createdAt: expect.any(Number)
		});
	});

	it('keeps the handoff when the route is invalid or absent', async () => {
		const ctx = makeCtx();

		await expect(
			handoffHandler._handler(ctx, {
				threadId: 'thread_1',
				anonymousUserId: 'anon_123',
				pageUrl: 'javascript:alert(1)'
			})
		).resolves.toBe(true);

		expect(saveMessageMock).toHaveBeenCalledTimes(2);
		expect(ctx.db.insert).not.toHaveBeenCalled();
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'supportThreads',
			'support_1',
			expect.objectContaining({ isHandedOff: true })
		);
	});
});
