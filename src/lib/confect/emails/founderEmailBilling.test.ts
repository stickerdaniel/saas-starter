import { ConvexLogger } from '@confect/server';
import * as Effect from 'effect/Effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionCtx } from '../../convex/_generated/server';
import { findWelcomeThread } from './founderEmailBilling';
import { resend } from './resend';

vi.hoisted(() => vi.stubEnv('RESEND_API_KEY', 're_test'));

const USER_ID = 'user_1';
const RESEND_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const MESSAGE_ID = '<111-222-333@email.example.com>';
const WELCOME = { emailId: 'email_1', subject: 'Welcome aboard' };
const BUDGET_MS = 5000;
const UNAVAILABLE = [{ code: 'founder_feedback_thread_unavailable' }];

const runQuery = vi.fn<() => Promise<unknown>>();
const ctx = { runQuery } as unknown as ActionCtx;
let warnings: unknown[] = [];

type ResendStub = (init: RequestInit) => Promise<Response>;
const network = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const answerResend = (respond: ResendStub) =>
	network.mockImplementation((_, init) => respond(init));
const resendRecord = (messageId: unknown) =>
	Response.json({ id: RESEND_ID, subject: WELCOME.subject, message_id: messageId });

const never = () => new Promise<never>(() => {});
function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
	return new Promise((_, reject) => {
		signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}
function stallingBody(signal: AbortSignal | null | undefined): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('{"message_id":'));
			signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
		}
	});
	return new Response(body, { status: 200 });
}

const find = () =>
	Effect.runPromise(findWelcomeThread(ctx, USER_ID).pipe(Effect.provide(ConvexLogger.layer)));
const signalOfResendRequest = () => network.mock.calls[0]?.[1].signal;

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv('RESEND_API_KEY', 're_test');
	vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
	vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');
	runQuery.mockReset();
	runQuery.mockResolvedValue(WELCOME);
	vi.spyOn(resend, 'get').mockResolvedValue({ resendId: RESEND_ID } as never);
	network.mockReset();
	answerResend(async () => resendRecord(MESSAGE_ID));
	vi.stubGlobal('fetch', network);
	warnings = [];
	vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
		warnings.push(...args);
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('findWelcomeThread', () => {
	it('replies in the thread of the sent welcome, as Resend recorded it', async () => {
		expect(await find()).toEqual({ inReplyTo: MESSAGE_ID, subject: WELCOME.subject });

		const [url, init] = network.mock.calls[0]!;
		expect(url).toBe(`https://api.resend.com/emails/${RESEND_ID}`);
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
		expect(resend.get).toHaveBeenCalledWith(ctx, WELCOME.emailId);
		expect(warnings).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('accepts a message id without angle brackets', async () => {
		answerResend(async () => resendRecord('111-222-333@email.example.com'));

		expect(await find()).toEqual({ inReplyTo: MESSAGE_ID, subject: WELCOME.subject });
	});

	it('sends standalone without a warning when the user has no sent welcome', async () => {
		runQuery.mockResolvedValue(null);

		expect(await find()).toBeUndefined();
		expect(network).not.toHaveBeenCalled();
		expect(warnings).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each<[string, () => void]>([
		['the ledger query rejects', () => runQuery.mockRejectedValue(new Error('ledger down'))],
		[
			'the component read rejects',
			() => vi.mocked(resend.get).mockRejectedValue(new Error('component down'))
		],
		[
			'the component has no Resend id yet',
			() => vi.mocked(resend.get).mockResolvedValue({ resendId: null } as never)
		],
		['email delivery is not configured', () => vi.stubEnv('AUTH_EMAIL', '')],
		[
			'the Resend request rejects',
			() =>
				answerResend(async () => {
					throw new TypeError('fetch failed');
				})
		],
		[
			'Resend refuses the read',
			() => answerResend(async () => new Response(null, { status: 500 }))
		],
		[
			'Resend answers with a broken body',
			() => answerResend(async () => new Response('{"message_id":', { status: 200 }))
		],
		['the record has no message id', () => answerResend(async () => Response.json({}))],
		['the message id is malformed', () => answerResend(async () => resendRecord('<a b@c>'))],
		[
			'reading the component record throws',
			() =>
				vi.mocked(resend.get).mockResolvedValue({
					get resendId(): string {
						throw new Error('record unreadable');
					}
				} as never)
		]
	])('sends standalone with one coded warning when %s', async (_, fail) => {
		fail();

		expect(await find()).toBeUndefined();
		expect(warnings).toEqual(UNAVAILABLE);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each<[string, () => void]>([
		['the ledger query', () => runQuery.mockImplementation(never)],
		['the component read', () => vi.mocked(resend.get).mockImplementation(never)],
		['the Resend headers', () => answerResend((init) => untilAborted(init.signal))],
		['the Resend body', () => answerResend(async (init) => stallingBody(init.signal))]
	])('gives up at 5 s when %s stalls', async (_, stall) => {
		stall();
		let settled = false;
		const thread = find().finally(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		expect(settled).toBe(true);
		expect(await thread).toBeUndefined();
		expect(warnings).toEqual(UNAVAILABLE);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('aborts the Resend request at the deadline', async () => {
		answerResend((init) => untilAborted(init.signal));
		const thread = find();

		await vi.advanceTimersByTimeAsync(BUDGET_MS);

		expect(await thread).toBeUndefined();
		expect(signalOfResendRequest()?.aborted).toBe(true);
	});

	it('counts the ledger query and Resend read against one 5 s budget', async () => {
		runQuery.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve(WELCOME), 3000))
		);
		answerResend(
			(init) =>
				new Promise((resolve) =>
					setTimeout(() => resolve(stallingBody(init.signal)), BUDGET_MS - 3000 - 1)
				)
		);
		const thread = find();

		await vi.advanceTimersByTimeAsync(BUDGET_MS);

		expect(await thread).toBeUndefined();
		expect(warnings).toEqual(UNAVAILABLE);
		expect(signalOfResendRequest()?.aborted).toBe(true);
	});
});
