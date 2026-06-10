import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../autumn', () => ({
	getAutumnSdk: vi.fn()
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
import { getAutumnSdk } from '../autumn';
import { appRateLimiter } from '../rateLimit';
import { enforceAndTrackMessageUsage, removeMessage, send } from '../messages';

const getAuthUserMock = authComponent.getAuthUser as unknown as ReturnType<typeof vi.fn>;
const getAutumnSdkMock = getAutumnSdk as unknown as ReturnType<typeof vi.fn>;
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
// not-allowed response from Autumn may remove a message. Missing data (HTTP
// error) or a thrown network error must keep it.
describe('enforceAndTrackMessageUsage', () => {
	let check: ReturnType<typeof vi.fn>;
	let track: ReturnType<typeof vi.fn>;
	let runMutation: ReturnType<typeof vi.fn>;
	let ctx: { runMutation: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		check = vi.fn();
		track = vi.fn().mockResolvedValue(undefined);
		runMutation = vi.fn().mockResolvedValue(null);
		ctx = { runMutation };
		getAutumnSdkMock.mockResolvedValue({ check, track });
	});

	it('tracks usage when the check allows the message', async () => {
		check.mockResolvedValue({ data: { allowed: true } });

		await enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' });

		expect(track).toHaveBeenCalledWith({ customer_id: 'user_1', feature_id: 'messages', value: 1 });
		expect(runMutation).not.toHaveBeenCalled();
	});

	it('removes the message only on a definitive not-allowed response', async () => {
		check.mockResolvedValue({ data: { allowed: false } });

		await enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' });

		expect(runMutation).toHaveBeenCalledWith('internal.messages.removeMessage', {
			messageId: 'msg_1'
		});
		expect(track).not.toHaveBeenCalled();
	});

	it('keeps and tracks the message when the check returns no data (HTTP error)', async () => {
		check.mockResolvedValue({ data: null });

		await enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' });

		expect(runMutation).not.toHaveBeenCalled();
		expect(track).toHaveBeenCalledWith({ customer_id: 'user_1', feature_id: 'messages', value: 1 });
	});

	it('keeps the message and skips tracking when the check throws (network error)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		check.mockRejectedValue(new Error('network down'));

		await expect(
			enforceHandler._handler(ctx, { userId: 'user_1', messageId: 'msg_1' })
		).resolves.toBeNull();

		expect(runMutation).not.toHaveBeenCalled();
		expect(track).not.toHaveBeenCalled();
		warn.mockRestore();
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
