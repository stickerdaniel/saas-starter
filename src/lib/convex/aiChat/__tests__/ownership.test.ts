import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAiChatThreadRecord } from '../ownership';

function createCtx(record: { threadId: string; userId: string } | null) {
	return {
		db: {
			query: vi.fn(() => ({
				withIndex: vi.fn(() => ({
					first: vi.fn().mockResolvedValue(record)
				}))
			}))
		}
	} as unknown as Parameters<typeof requireAiChatThreadRecord>[0];
}

describe('ai chat ownership helper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the ai chat record for the owning user', async () => {
		const ctx = createCtx({ threadId: 'thread_1', userId: 'user_1' });

		const result = await requireAiChatThreadRecord(ctx, {
			threadId: 'thread_1',
			userId: 'user_1'
		});

		expect(result).toEqual({ threadId: 'thread_1', userId: 'user_1' });
	});

	it('rejects a missing ai chat record', async () => {
		const ctx = createCtx(null);

		await expect(
			requireAiChatThreadRecord(ctx, {
				threadId: 'missing_thread',
				userId: 'user_1'
			})
		).rejects.toThrow('Thread not found');
	});

	it('rejects a thread owned by a different user', async () => {
		const ctx = createCtx({ threadId: 'thread_1', userId: 'user_2' });

		await expect(
			requireAiChatThreadRecord(ctx, {
				threadId: 'thread_1',
				userId: 'user_1'
			})
		).rejects.toThrow('Thread not found');
	});
});
