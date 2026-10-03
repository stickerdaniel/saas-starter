import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agent', () => ({
	supportAgent: { createThread: vi.fn() }
}));
vi.mock('../../_generated/api', () => ({
	components: {
		betterAuth: { adapter: { findOne: 'components.betterAuth.adapter.findOne' } },
		agent: {
			messages: { listMessagesByThreadId: 'components.agent.messages.listMessagesByThreadId' }
		}
	}
}));

import { supportAgent } from '../agent';
import { createSupportThreadRecord } from '../threadLifecycle';

const createThreadMock = supportAgent.createThread as unknown as ReturnType<typeof vi.fn>;

function makeCtx() {
	return {
		db: { insert: vi.fn() },
		runQuery: vi.fn()
	};
}

describe('createSupportThreadRecord route metadata', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThreadMock.mockResolvedValue({ threadId: 'thread_1' });
	});

	it.each([
		['https://example.com/es/app?tab=files#message', '/es/app'],
		['data:text/html,phish', undefined]
	])('normalizes %s before the thread write', async (pageUrl, expected) => {
		const ctx = makeCtx();

		await createSupportThreadRecord(ctx as never, {
			resolvedUserId: 'anon_123',
			isAnonymous: true,
			title: 'Customer Support',
			summary: 'New support conversation',
			pageUrl,
			isWarm: true,
			awaitingAdminResponse: false
		});

		expect(ctx.db.insert).toHaveBeenCalledWith(
			'supportThreads',
			expect.objectContaining({ pageUrl: expected })
		);
	});
});
