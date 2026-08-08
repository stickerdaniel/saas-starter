import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// createAIResponse pulls in the whole support module graph at import. Stub the
// heavy or env-dependent siblings so this stays a handler-level unit test that
// only exercises the prompt-override wiring into streamText.
vi.mock('../agent', () => ({
	supportAgent: {
		streamText: vi.fn(),
		saveMessage: vi.fn()
	}
}));

vi.mock('../rateLimit', () => ({
	supportRateLimiter: {
		limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 })
	}
}));

vi.mock('../types', () => ({
	createRateLimitError: vi.fn(() => new Error('rate limited'))
}));

vi.mock('../../i18n/translations', () => ({
	t: vi.fn(() => 'translated'),
	extractLocaleFromUrl: vi.fn(() => 'en')
}));

vi.mock('../ownership', () => ({
	requireSupportThreadAccess: vi.fn()
}));

vi.mock('../messageListing', () => ({
	listMessagesForThread: vi.fn()
}));

vi.mock('../threads', () => ({
	syncSupportLastMessage: vi.fn()
}));

vi.mock('../../files/metadata', () => ({
	getFileMetadataByUrls: vi.fn()
}));

vi.mock('../../aiUsage/agentUsage', () => ({
	makeAgentUsageSink: vi.fn(() => ({ usageHandler: vi.fn(), collect: () => [] }))
}));

vi.mock('../../aiUsage/record', () => ({
	recordAiUsage: vi.fn()
}));

vi.mock('../../constants', () => ({ MAX_MESSAGE_LENGTH: 4000 }));

vi.mock('../../../config/support', () => ({ isSupportAiEnabled: vi.fn(() => true) }));

vi.mock('@convex-dev/agent', () => ({ getFile: vi.fn() }));

vi.mock('@convex-dev/agent/validators', async () => {
	const { v } = await import('convex/values');
	return { vStreamArgs: v.optional(v.any()) };
});

// Ref strings are inlined here because vi.mock factories are hoisted above any
// module-scope const. The same literals are re-declared below for the assertions.
vi.mock('../../_generated/api', () => ({
	components: {},
	internal: {
		support: {
			handoff: { internalSetHandoff: 'internal.support.handoff.internalSetHandoff' },
			promptStore: { getActive: 'internal.support.promptStore.getActive' },
			threads: { updateLastMessage: 'internal.support.threads.updateLastMessage' },
			messages: { createAIResponse: 'internal.support.messages.createAIResponse' }
		},
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

const GET_ACTIVE_REF = 'internal.support.promptStore.getActive';

import { getFile } from '@convex-dev/agent';
import { supportAgent } from '../agent';
import { requireSupportThreadAccess } from '../ownership';
import { createAIResponse, sendMessage } from '../messages';
import { syncSupportLastMessage } from '../threads';
import { isSupportAiEnabled } from '../../../config/support';

const syncMock = syncSupportLastMessage as unknown as ReturnType<typeof vi.fn>;

const aiEnabledMock = isSupportAiEnabled as unknown as ReturnType<typeof vi.fn>;

const streamTextMock = supportAgent.streamText as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const handler = createAIResponse as unknown as Fn<
	{ threadId: string; promptMessageId: string; userId?: string },
	null
>;

const args = { threadId: 'thread_1', promptMessageId: 'prompt_1', userId: 'user_1' };

function makeCtx(override: string | null) {
	return {
		runQuery: vi.fn(async (ref: string) => (ref === GET_ACTIVE_REF ? override : undefined)),
		runMutation: vi.fn().mockResolvedValue(null)
	};
}

describe('createAIResponse prompt override wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		streamTextMock.mockResolvedValue({
			consumeStream: vi.fn().mockResolvedValue(undefined)
		});
	});

	afterEach(() => {
		aiEnabledMock.mockReturnValue(true);
	});

	// Dropping the job outright would strand the message: nothing answers, and
	// the thread is not handed off either, so it is absent from the admin lists.
	it('hands a job scheduled before the switch to the team instead of dropping it', async () => {
		aiEnabledMock.mockReturnValue(false);
		const ctx = { runQuery: vi.fn(), runMutation: vi.fn().mockResolvedValue(null) };

		await handler._handler(ctx, args);

		expect(streamTextMock).not.toHaveBeenCalled();
		expect(ctx.runQuery).not.toHaveBeenCalled();
		// acknowledge, because no model speaks in this turn: without it the visitor
		// gets no reply at all, and an anonymous one gets no email prompt either.
		expect(ctx.runMutation).toHaveBeenCalledWith('internal.support.handoff.internalSetHandoff', {
			threadId: 'thread_1',
			acknowledge: true
		});
	});

	it('passes the active stored prompt to streamText as the system override', async () => {
		const ctx = makeCtx('stored override prompt');

		await handler._handler(ctx, args);

		expect(ctx.runQuery).toHaveBeenCalledWith(GET_ACTIVE_REF, {});
		expect(streamTextMock).toHaveBeenCalledTimes(1);
		expect(streamTextMock.mock.calls[0][2]).toEqual({
			promptMessageId: 'prompt_1',
			system: 'stored override prompt'
		});
	});

	it('leaves system undefined so the seed prompt stands when none is active', async () => {
		const ctx = makeCtx(null);

		await handler._handler(ctx, args);

		expect(streamTextMock.mock.calls[0][2]).toEqual({
			promptMessageId: 'prompt_1',
			system: undefined
		});
	});
});

// The component keeps a file alive only while a stored message references it via
// message.fileIds; the vacuum deletes any file whose refcount is 0. sendMessage
// therefore has to forward the attached fileIds as saveMessage metadata, and only
// for the multimodal branch — a plain text message must not carry a fileIds key.
describe('sendMessage attachment refcount metadata', () => {
	const requireAccessMock = requireSupportThreadAccess as unknown as ReturnType<typeof vi.fn>;
	const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;
	const getFileMock = getFile as unknown as ReturnType<typeof vi.fn>;

	const sendHandler = sendMessage as unknown as Fn<
		{ threadId: string; prompt: string; fileIds?: string[] },
		{ messageId: string }
	>;

	function makeSendCtx() {
		return {
			db: { patch: vi.fn() },
			scheduler: { runAfter: vi.fn() }
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		requireAccessMock.mockResolvedValue({
			owner: { ownerId: 'user_1', isAnonymous: false },
			supportThread: {
				_id: 'st_1',
				status: 'open',
				isWarm: false,
				isHandedOff: false,
				pageUrl: ''
			}
		});
		saveMessageMock.mockResolvedValue({ messageId: 'm1' });
		getFileMock.mockResolvedValue({
			filePart: {
				type: 'file',
				data: new URL('https://files/f1'),
				mediaType: 'image/png',
				filename: 'f1.png'
			}
		});
	});

	it('forwards fileIds as saveMessage metadata for a multimodal message', async () => {
		const ctx = makeSendCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi', fileIds: ['file_1'] });

		// Agent instance method signature is saveMessage(ctx, args), so the args
		// object is the second positional argument.
		expect(saveMessageMock.mock.calls[0][1].metadata).toEqual({ fileIds: ['file_1'] });
	});

	it('does not attach metadata for a text-only message', async () => {
		const ctx = makeSendCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		expect(saveMessageMock.mock.calls[0][1].metadata).toBeUndefined();
	});
});

describe('sendMessage routing between the agent and the team', () => {
	const requireAccessMock = requireSupportThreadAccess as unknown as ReturnType<typeof vi.fn>;
	const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;

	const sendHandler = sendMessage as unknown as Fn<
		{ threadId: string; prompt: string },
		{ messageId: string }
	>;

	const CREATE_AI_RESPONSE_REF = 'internal.support.messages.createAIResponse';
	const SCHEDULE_NOTIFICATION_REF =
		'internal.admin.support.notifications.scheduleAdminNotification';
	const RECENT_USER_MESSAGES_REF = 'internal.admin.support.notifications.getRecentUserMessages';

	beforeEach(() => {
		vi.clearAllMocks();
		saveMessageMock.mockResolvedValue({ messageId: 'm1' });
	});

	afterEach(() => {
		aiEnabledMock.mockReturnValue(true);
	});

	function makeCtx(recentUserMessages: string[] = []) {
		return {
			db: { patch: vi.fn() },
			runQuery: vi.fn().mockResolvedValue(recentUserMessages),
			runMutation: vi.fn().mockResolvedValue(null),
			scheduler: { runAfter: vi.fn() }
		};
	}

	function givenThread(overrides: Record<string, unknown>) {
		requireAccessMock.mockResolvedValue({
			owner: { ownerId: 'user_1', isAnonymous: false },
			supportThread: {
				_id: 'st_1',
				status: 'open',
				isWarm: false,
				isHandedOff: false,
				pageUrl: '',
				...overrides
			}
		});
	}

	/** The reference each scheduled job was queued under, in call order. */
	function scheduledRefs(ctx: ReturnType<typeof makeCtx>): string[] {
		return ctx.scheduler.runAfter.mock.calls.map((call) => call[1] as string);
	}

	it('answers with the agent and leaves the team alone by default', async () => {
		givenThread({ isWarm: true });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		expect(scheduledRefs(ctx)).toEqual([CREATE_AI_RESPONSE_REF]);
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'st_1',
			expect.objectContaining({ isHandedOff: false })
		);
	});

	it('sends a first message straight to the team as a new ticket when the AI is off', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isWarm: true, isHandedOff: false });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'the map is blank' });

		expect(scheduledRefs(ctx)).toEqual([SCHEDULE_NOTIFICATION_REF]);
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'newTickets', isReopen: false })
		);
		// A warm thread was created empty, so this message is the conversation and
		// there is no history worth scanning for.
		expect(ctx.runQuery).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ messageIds: ['m1'] })
		);
	});

	it('latches a thread from the agent era onto the team on its next message', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isHandedOff: false });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'still broken' });

		expect(scheduledRefs(ctx)).toEqual([SCHEDULE_NOTIFICATION_REF]);
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'st_1',
			expect.objectContaining({ isHandedOff: true })
		);
		// The team has never seen this thread, so it arrives as a ticket rather
		// than as a reply on one they already hold.
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'newTickets' })
		);
	});

	// "still broken" on its own is not a ticket anyone can work: the report it
	// refers to was written while the agent was still answering.
	it('announces the conversation, not just the follow-up, on an agent-era thread', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isHandedOff: false });
		const ctx = makeCtx(['msg_report', 'msg_details', 'msg_followup']);

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'still broken' });

		expect(ctx.runQuery).toHaveBeenCalledWith(RECENT_USER_MESSAGES_REF, { threadId: 't1' });
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ messageIds: ['msg_report', 'msg_details', 'msg_followup'] })
		);
	});

	// The rest of the conversation is already on the ticket they hold, and asking
	// for it again would re-announce messages they have read.
	it('announces only the reply on a thread the team already holds', async () => {
		givenThread({ isHandedOff: true });
		const ctx = makeCtx(['msg_report']);

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'any news?' });

		expect(ctx.runQuery).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ messageIds: ['m1'] })
		);
	});

	// The email prompt in the widget renders against this message, and without
	// it an anonymous visitor gets no reply at all on their first report.
	it('acknowledges the first message that reaches the team', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isWarm: true, isHandedOff: false });

		await sendHandler._handler(makeCtx(), { threadId: 't1', prompt: 'the map is blank' });

		const calls = saveMessageMock.mock.calls;
		expect(calls[calls.length - 1][1].message).toEqual({
			role: 'assistant',
			content: 'translated'
		});
	});

	// The denormalized fields drive the admin list preview and the search index
	// built from it. This sentence is identical on every new ticket, so syncing
	// it would leave the inbox a column of the same text with the report itself
	// unsearchable.
	it('leaves the report as the admin preview rather than the acknowledgement', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isWarm: true, isHandedOff: false });

		await sendHandler._handler(makeCtx(), { threadId: 't1', prompt: 'the map is blank' });

		const ackIndex = saveMessageMock.mock.calls.findIndex(
			(call) => call[1].message?.role === 'assistant'
		);
		expect(ackIndex).toBeGreaterThan(-1);
		expect(syncMock.mock.invocationCallOrder[0]).toBeLessThan(
			saveMessageMock.mock.invocationCallOrder[ackIndex]
		);
		// Syncing again afterwards would put the acknowledgement back into the
		// preview, so ordering alone is not the whole guarantee.
		expect(syncMock).toHaveBeenCalledTimes(1);
	});

	it('does not acknowledge again on a thread the team already holds', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isHandedOff: true });

		await sendHandler._handler(makeCtx(), { threadId: 't1', prompt: 'any news?' });

		expect(saveMessageMock).toHaveBeenCalledTimes(1);
	});

	it('reports a follow-up on a thread the team already holds as a user reply', async () => {
		givenThread({ isHandedOff: true });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'any news?' });

		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'userReplies' })
		);
	});

	// updateThreadHandoff flags a thread handed off without clearing isWarm and
	// announces the ticket itself, so with the agent on the detail message that
	// follows is a reply on a ticket the team already holds.
	it('reports the message after an agent-era handoff as a user reply', async () => {
		givenThread({ isWarm: true, isHandedOff: true });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'here are the steps' });

		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'userReplies' })
		);
	});

	it('reports a reopened ticket as a new ticket', async () => {
		givenThread({ isHandedOff: true, status: 'done' });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'happening again' });

		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'newTickets', isReopen: true })
		);
	});
});
