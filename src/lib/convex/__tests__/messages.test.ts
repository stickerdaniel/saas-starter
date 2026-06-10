import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../autumn', () => ({
	checkAndCountUsage: vi.fn()
}));

vi.mock('../rateLimit', () => ({
	appRateLimiter: {
		limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 })
	}
}));

vi.mock('../_generated/api', () => ({
	components: {},
	internal: {
		messages: {
			removeMessage: 'internal.messages.removeMessage',
			enforceAndTrackMessageUsage: 'internal.messages.enforceAndTrackMessageUsage'
		}
	}
}));

import { authComponent } from '../auth';
import { checkAndCountUsage } from '../autumn';
import { appRateLimiter } from '../rateLimit';
import { enforceAndTrackMessageUsage, removeMessage, send } from '../messages';

const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;
const checkAndCountUsageMock = checkAndCountUsage as unknown as ReturnType<typeof vi.fn>;
const limitMock = appRateLimiter.limit as unknown as ReturnType<typeof vi.fn>;

type RegisteredFunction<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const enforceHandler = enforceAndTrackMessageUsage as unknown as RegisteredFunction<
	{ userId: string; messageId: string },
	null
>;
const removeHandler = removeMessage as unknown as RegisteredFunction<{ messageId: string }, null>;
const sendHandler = send as unknown as RegisteredFunction<{ body: string }, { messageId: string }>;

// The quota backstop deletes user messages in a silent at-most-once scheduled
// action, so its keep/remove decision must never regress: only a definitive
// 'denied' outcome may remove a message. 'unavailable' (Autumn outage) must
// keep it. The outcome mapping itself is covered in __tests__/autumn.test.ts;
// usage is counted by the atomic check, so no separate track call exists.
describe('enforceAndTrackMessageUsage', () => {
	let runMutation: ReturnType<typeof vi.fn>;
	let ctx: { runMutation: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		runMutation = vi.fn().mockResolvedValue(null);
		ctx = { runMutation };
	});

	it('keeps a counted message without any follow-up call', async () => {
		checkAndCountUsageMock.mockResolvedValue('counted');

		await enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' });

		expect(checkAndCountUsageMock).toHaveBeenCalledWith({
			customerId: 'user_1',
			featureId: 'messages'
		});
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('removes the message only on a definitive denial', async () => {
		checkAndCountUsageMock.mockResolvedValue('denied');

		await enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' });

		expect(runMutation).toHaveBeenCalledWith('internal.messages.removeMessage', {
			messageId: 'msg_1'
		});
	});

	it('keeps the message uncounted when Autumn is unavailable', async () => {
		checkAndCountUsageMock.mockResolvedValue('unavailable');

		await expect(
			enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' })
		).resolves.toBeNull();

		expect(runMutation).not.toHaveBeenCalled();
	});
});

describe('removeMessage', () => {
	it('deletes an existing message', async () => {
		const del = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			db: { get: vi.fn().mockResolvedValue({ _id: 'msg_1' }), delete: del }
		};

		await removeHandler._handler(ctx, { messageId: 'msg_1' });

		expect(del).toHaveBeenCalledWith('msg_1');
	});

	it('is a no-op when the message is already gone', async () => {
		const del = vi.fn();
		const ctx = {
			db: { get: vi.fn().mockResolvedValue(null), delete: del }
		};

		await removeHandler._handler(ctx, { messageId: 'msg_1' });

		expect(del).not.toHaveBeenCalled();
	});
});

describe('send', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAuthUserMock.mockResolvedValue({ _id: 'user_1' });
		limitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
	});

	it('rejects with a structured error when the rate limit is exhausted', async () => {
		limitMock.mockResolvedValue({ ok: false, retryAfter: 12000 });
		const insert = vi.fn();
		const runAfter = vi.fn();
		const ctx = { db: { insert }, scheduler: { runAfter } };

		await expect(sendHandler._handler(ctx, { body: 'hello' })).rejects.toMatchObject({
			data: { code: 'RATE_LIMITED', retryAfter: 12000 }
		});
		expect(insert).not.toHaveBeenCalled();
		expect(runAfter).not.toHaveBeenCalled();
	});

	it('inserts the message and schedules the quota backstop with its id', async () => {
		const insert = vi.fn().mockResolvedValue('msg_1');
		const runAfter = vi.fn().mockResolvedValue(undefined);
		const ctx = { db: { insert }, scheduler: { runAfter } };

		const result = await sendHandler._handler(ctx, { body: 'hello' });

		expect(result).toEqual({ messageId: 'msg_1' });
		expect(limitMock).toHaveBeenCalledWith(expect.anything(), 'communityMessage', {
			key: 'user_1'
		});
		expect(runAfter).toHaveBeenCalledWith(0, 'internal.messages.enforceAndTrackMessageUsage', {
			userId: 'user_1',
			messageId: 'msg_1'
		});
	});
});
