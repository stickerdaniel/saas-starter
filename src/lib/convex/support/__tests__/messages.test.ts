import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HandoffModule from '../handoff';

// createAIResponse pulls in the whole support module graph at import. Stub the
// heavy or env-dependent siblings so this stays a handler-level unit test that
// only exercises the prompt-override wiring into streamText.
// Journey capture is covered by its own tests; these stay on their concern.
vi.mock('../../admin/journey/capture', () => ({ ensureCaptureStart: vi.fn() }));

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

// The watchdog's handoff is covered in support/handoff.test.ts; here it is the
// call the watchdog makes.
vi.mock('../handoff', async (importOriginal) => ({
	...(await importOriginal<typeof HandoffModule>()),
	settleUnanswered: vi.fn()
}));

vi.mock('../../constants', () => ({ MAX_MESSAGE_LENGTH: 4000 }));

vi.mock('../../../config/support', () => ({ isSupportAiEnabled: vi.fn(() => true) }));

vi.mock('../../env', () => {
	class CapabilityConfigurationError extends Error {}
	return {
		CapabilityConfigurationError,
		getCapabilityConfigurations: vi.fn(() => ({
			billing: { state: 'ready', value: { secretKey: 'configured' } },
			email: {
				state: 'ready',
				value: {
					apiKey: 'configured',
					sender: 'sender@example.com',
					assetUrl: 'https://assets.example.com'
				}
			},
			ai: { state: 'ready', value: { apiKey: 'configured' } }
		})),
		requireAiConfiguration: vi.fn(() => ({ apiKey: 'configured' }))
	};
});

vi.mock('@convex-dev/agent', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, getFile: vi.fn() };
});

vi.mock('@convex-dev/agent/validators', async () => {
	const { v } = await import('convex/values');
	return { vStreamArgs: v.optional(v.any()) };
});

// Ref strings are inlined here because vi.mock factories are hoisted above any
// module-scope const. The same literals are re-declared below for the assertions.
vi.mock('../../_generated/api', () => ({
	components: {
		agent: {
			messages: {
				getMessagesByIds: 'components.agent.messages.getMessagesByIds',
				listMessagesByThreadId: 'components.agent.messages.listMessagesByThreadId'
			}
		}
	},
	internal: {
		support: {
			handoff: {
				internalSetHandoff: 'internal.support.handoff.internalSetHandoff',
				settleUnansweredTurn: 'internal.support.handoff.settleUnansweredTurn'
			},
			promptStore: { getActive: 'internal.support.promptStore.getActive' },
			threads: {
				getThreadLocale: 'internal.support.threads.getThreadLocale',
				updateLastMessage: 'internal.support.threads.updateLastMessage'
			},
			messages: {
				createAIResponse: 'internal.support.messages.createAIResponse',
				createAssistantMessage: 'internal.support.messages.createAssistantMessage',
				ensureSupportTurnSettled: 'internal.support.messages.ensureSupportTurnSettled',
				getTurnOutcome: 'internal.support.messages.getTurnOutcome'
			}
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
const GET_TURN_OUTCOME_REF = 'internal.support.messages.getTurnOutcome';

import { APICallError, RetryError } from 'ai';
import { getFile } from '@convex-dev/agent';
import type { MessageDoc } from '@convex-dev/agent/validators';
import { supportAgent } from '../agent';
import { requireSupportThreadAccess } from '../ownership';
import { supportRateLimiter } from '../rateLimit';
import { settleUnanswered } from '../handoff';
import {
	createAIResponse,
	createAssistantMessage,
	ensureSupportTurnSettled,
	getTurnOutcome,
	listMessages,
	sendMessage
} from '../messages';
import { listMessagesForThread } from '../messageListing';
import { makeAgentUsageSink } from '../../aiUsage/agentUsage';
import { recordAiUsage } from '../../aiUsage/record';
import { syncSupportLastMessage } from '../threads';
import { isSupportAiEnabled } from '../../../config/support';
import {
	CapabilityConfigurationError,
	getCapabilityConfigurations,
	requireAiConfiguration
} from '../../env';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../../chat/core/tool-error-redaction';

const syncMock = syncSupportLastMessage as unknown as ReturnType<typeof vi.fn>;

const aiEnabledMock = isSupportAiEnabled as unknown as ReturnType<typeof vi.fn>;
const getCapabilitiesMock = getCapabilityConfigurations as unknown as ReturnType<typeof vi.fn>;
const requireAiMock = requireAiConfiguration as unknown as ReturnType<typeof vi.fn>;

const streamTextMock = supportAgent.streamText as unknown as ReturnType<typeof vi.fn>;

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const handler = createAIResponse as unknown as Fn<
	{ threadId: string; promptMessageId: string; userId?: string },
	null
>;

const args = { threadId: 'thread_1', promptMessageId: 'prompt_1', userId: 'user_1' };

type TurnOutcome = { handedOff: boolean; answered: boolean; visibleText: boolean };
const NOTHING_SHOWN: TurnOutcome = { handedOff: false, answered: false, visibleText: false };
const ANSWERED: TurnOutcome = { handedOff: false, answered: true, visibleText: true };
/** The read when the queued job starts, then the one right before the first dispatch. */
const READY = [NOTHING_SHOWN, NOTHING_SHOWN];

/**
 * An action ctx for createAIResponse. getTurnOutcome answers from `outcomes` in
 * order: the two READY reads, the read after the first attempt, then the reads
 * before and after the second. A read beyond them fails the test, so each case
 * states exactly how far the turn runs.
 */
function makeCtx(override: string | null, outcomes: TurnOutcome[] = [...READY, ANSWERED]) {
	const pending = [...outcomes];
	return {
		runQuery: vi.fn(async (ref: string) => {
			if (ref === GET_TURN_OUTCOME_REF) {
				const next = pending.shift();
				if (!next) throw new Error('unexpected turn outcome read');
				return next;
			}
			return ref === GET_ACTIVE_REF ? override : undefined;
		}),
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

	it('hands queued work to the team when AI configuration is lost', async () => {
		requireAiMock.mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});
		const ctx = { runQuery: vi.fn(), runMutation: vi.fn().mockResolvedValue(null) };

		await handler._handler(ctx, args);

		expect(streamTextMock).not.toHaveBeenCalled();
		expect(ctx.runQuery).not.toHaveBeenCalled();
		expect(ctx.runMutation).toHaveBeenCalledWith('internal.support.handoff.internalSetHandoff', {
			threadId: 'thread_1',
			acknowledge: true
		});
	});

	it('hands off if AI is lost immediately before model transport', async () => {
		requireAiMock.mockReturnValueOnce({ apiKey: 'configured' }).mockImplementationOnce(() => {
			throw new CapabilityConfigurationError('ai', 'misconfigured');
		});
		const ctx = makeCtx('stored override prompt');

		await handler._handler(ctx, args);

		expect(ctx.runQuery).toHaveBeenCalledWith(GET_ACTIVE_REF, {});
		expect(streamTextMock).not.toHaveBeenCalled();
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
			instructions: 'stored override prompt',
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform
		});
	});

	it('leaves system undefined so the seed prompt stands when none is active', async () => {
		const ctx = makeCtx(null);

		await handler._handler(ctx, args);

		expect(streamTextMock.mock.calls[0][2]).toEqual({
			promptMessageId: 'prompt_1',
			instructions: undefined,
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform
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
	const ENSURE_SETTLED_REF = 'internal.support.messages.ensureSupportTurnSettled';
	const SCHEDULE_NOTIFICATION_REF =
		'internal.admin.support.notifications.scheduleAdminNotification';
	const RECENT_USER_MESSAGES_REF = 'internal.admin.support.notifications.getRecentUserMessages';

	// A distinct id per save, so an assertion about which message the team was
	// told about cannot be satisfied by the acknowledgement written after it.
	beforeEach(() => {
		vi.clearAllMocks();
		let saves = 0;
		saveMessageMock.mockImplementation(async () => ({ messageId: `m${++saves}` }));
	});

	afterEach(() => {
		aiEnabledMock.mockReturnValue(true);
		vi.unstubAllEnvs();
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

		expect(scheduledRefs(ctx)).toEqual([CREATE_AI_RESPONSE_REF, ENSURE_SETTLED_REF]);
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'supportThreads',
			'st_1',
			expect.objectContaining({ isHandedOff: false })
		);
		// The visitor's message and nothing else. With the agent on, the model
		// answers, and a canned acknowledgement alongside it would read as the
		// assistant replying twice.
		expect(saveMessageMock).toHaveBeenCalledTimes(1);
	});

	// A scheduled action runs at most once and can die before it settles the
	// turn, so each agent turn gets a watchdog bound to its own job.
	it('watches the queued agent job of the turn', async () => {
		givenThread({ isWarm: true });
		const ctx = makeCtx();
		ctx.scheduler.runAfter.mockResolvedValueOnce('job_1');

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'hi' });

		expect(
			ctx.scheduler.runAfter.mock.calls.find((call) => call[1] === ENSURE_SETTLED_REF)
		).toEqual([
			3 * 60 * 1000,
			ENSURE_SETTLED_REF,
			{ threadId: 't1', promptMessageId: 'm1', jobId: 'job_1', checksLeft: 5 }
		]);
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
		// m1 is the visitor's report; m2 is the acknowledgement saved after it.
		// The team has to be pointed at the report.
		expect(saveMessageMock).toHaveBeenCalledTimes(2);
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ messageIds: ['m1'] })
		);
	});

	it('persists the human handoff when configured AI is unavailable before scheduling', async () => {
		getCapabilitiesMock.mockReturnValueOnce({
			billing: { state: 'ready', value: { secretKey: 'configured' } },
			email: {
				state: 'ready',
				value: {
					apiKey: 'configured',
					sender: 'sender@example.com',
					assetUrl: 'https://assets.example.com'
				}
			},
			ai: { state: 'misconfigured', issue: 'missing' }
		});
		givenThread({ isWarm: true, isHandedOff: false });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'the map is blank' });

		expect(scheduledRefs(ctx)).toEqual([SCHEDULE_NOTIFICATION_REF]);
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'supportThreads',
			'st_1',
			expect.objectContaining({ isHandedOff: true })
		);
		expect(saveMessageMock).toHaveBeenCalledTimes(2);
	});

	it('keeps a local E2E support prompt out of agent scheduling and provider transport', async () => {
		vi.stubEnv('CAPABILITY_PROFILE', 'test');
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'local-e2e-helper');
		getCapabilitiesMock.mockReturnValueOnce({
			billing: { state: 'disabled', issue: 'missing' },
			email: { state: 'disabled', issue: 'missing' },
			ai: { state: 'disabled', issue: 'missing' }
		});
		givenThread({ isWarm: true, isHandedOff: false });
		const ctx = makeCtx();
		const prompt = 'local-e2e-prompt-must-not-egress';

		await sendHandler._handler(ctx, { threadId: 't1', prompt });

		expect(scheduledRefs(ctx)).toEqual([SCHEDULE_NOTIFICATION_REF]);
		expect(ctx.scheduler.runAfter.mock.calls).not.toContainEqual(
			expect.arrayContaining([expect.anything(), CREATE_AI_RESPONSE_REF, expect.anything()])
		);
		expect(JSON.stringify(ctx.scheduler.runAfter.mock.calls)).not.toContain(prompt);
		expect(streamTextMock).not.toHaveBeenCalled();
		expect(requireAiMock).not.toHaveBeenCalled();
	});

	// The history query keeps the newest 50 entries of any role and filters to
	// user ones afterwards, so an acknowledgement written first takes a slot and
	// can push the oldest report out of exactly the window meant to carry it.
	it('reads the history before writing the acknowledgement', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isHandedOff: false });
		const ctx = makeCtx(['msg_report']);

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'still broken' });

		const ackIndex = saveMessageMock.mock.calls.findIndex(
			(call) => call[1].message?.role === 'assistant'
		);
		expect(ackIndex).toBeGreaterThan(-1);
		expect(ctx.runQuery.mock.invocationCallOrder[0]).toBeLessThan(
			saveMessageMock.mock.invocationCallOrder[ackIndex]
		);
	});

	it('latches a thread from the agent era onto the team on its next message', async () => {
		aiEnabledMock.mockReturnValue(false);
		givenThread({ isHandedOff: false });
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'still broken' });

		expect(scheduledRefs(ctx)).toEqual([SCHEDULE_NOTIFICATION_REF]);
		expect(ctx.db.patch).toHaveBeenCalledWith(
			'supportThreads',
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

describe('sendMessage per-message route', () => {
	const requireAccessMock = requireSupportThreadAccess as unknown as ReturnType<typeof vi.fn>;
	const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;

	const sendHandler = sendMessage as unknown as Fn<
		{ threadId: string; prompt: string; fileIds?: string[]; pageUrl?: string },
		{ messageId: string }
	>;

	beforeEach(() => {
		vi.clearAllMocks();
		requireAccessMock.mockResolvedValue({
			owner: { ownerId: 'user_1', isAnonymous: false },
			supportThread: {
				_id: 'st_1',
				status: 'open',
				isWarm: false,
				isHandedOff: true,
				pageUrl: '/en/app'
			}
		});
		let saves = 0;
		saveMessageMock.mockImplementation(async () => ({ messageId: `message_${++saves}` }));
		(getFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			filePart: { type: 'file', data: new URL('https://files/f1'), mediaType: 'image/png' }
		});
	});

	function makeCtx() {
		return {
			db: { patch: vi.fn(), insert: vi.fn() },
			runQuery: vi.fn().mockResolvedValue([]),
			runMutation: vi.fn().mockResolvedValue(null),
			scheduler: { runAfter: vi.fn() }
		};
	}

	// The thread holds one pageUrl and warm-thread reuse overwrites it, so
	// without a row per message nothing says which page a later report was
	// written from.
	it('records the normalized pathname of each message against its id', async () => {
		const ctx = makeCtx();

		await sendHandler._handler(ctx, {
			threadId: 't1',
			prompt: 'The chart is empty',
			pageUrl: 'https://example.com/de/app?panel=details#message'
		});
		await sendHandler._handler(ctx, {
			threadId: 't1',
			prompt: 'Here too',
			fileIds: ['file_1'],
			pageUrl: '/fr/app/settings?tab=billing'
		});

		expect(ctx.db.insert.mock.calls).toEqual([
			[
				'supportMessageContexts',
				expect.objectContaining({ threadId: 't1', messageId: 'message_1', pageUrl: '/de/app' })
			],
			[
				'supportMessageContexts',
				expect.objectContaining({
					threadId: 't1',
					messageId: 'message_2',
					pageUrl: '/fr/app/settings'
				})
			]
		]);
	});

	it.each([
		['non-HTTP scheme', 'javascript:alert(1)'],
		['protocol-relative destination', '//evil.example/phish'],
		['oversized UTF-8 value', `/de/${'ü'.repeat(2048)}`]
	])('keeps the message when the %s route is invalid', async (_label, pageUrl) => {
		const ctx = makeCtx();

		await expect(
			sendHandler._handler(ctx, { threadId: 't1', prompt: 'The chart is empty', pageUrl })
		).resolves.toEqual({ messageId: 'message_1' });

		expect(saveMessageMock).toHaveBeenCalledTimes(1);
		expect(ctx.db.insert).not.toHaveBeenCalled();
	});

	// The argument stays optional so a client from before this existed remains
	// valid, and one that sends nothing must not leave a row claiming a route.
	it('writes no row when the client sends no route', async () => {
		const ctx = makeCtx();

		await sendHandler._handler(ctx, { threadId: 't1', prompt: 'The chart is empty' });

		expect(ctx.db.insert).not.toHaveBeenCalled();
	});
});

/**
 * A mid-stream provider failure: the agent's stream ended with nothing but a
 * failed reasoning row, consumeStream() returned normally, and the visitor got
 * no reply while the thread stayed out of the team's lists. These cases run the
 * turn against the persisted outcome each read returns.
 */
describe('createAIResponse turn recovery', () => {
	const limitMock = supportRateLimiter.limit as unknown as ReturnType<typeof vi.fn>;
	const recordMock = recordAiUsage as unknown as ReturnType<typeof vi.fn>;
	const sinkMock = makeAgentUsageSink as unknown as ReturnType<typeof vi.fn>;
	const SETTLE_REF = 'internal.support.handoff.settleUnansweredTurn';
	const LAST_MESSAGE = ['internal.support.threads.updateLastMessage', { threadId: 'thread_1' }];
	const TURN = { threadId: 'thread_1', promptMessageId: 'm1' };
	const HANDED_OFF_SILENT: TurnOutcome = { handedOff: true, answered: false, visibleText: false };
	const PARTIAL: TurnOutcome = { handedOff: false, answered: false, visibleText: true };

	beforeEach(() => {
		vi.clearAllMocks();
		aiEnabledMock.mockReturnValue(true);
		// Reset, not just cleared: a once-value a case does not reach would
		// otherwise answer the next case's call.
		limitMock.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
		streamTextMock
			.mockReset()
			.mockResolvedValue({ consumeStream: vi.fn().mockResolvedValue(undefined) });
		sinkMock.mockReset().mockImplementation(() => ({ usageHandler: vi.fn(), collect: () => [] }));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function settled(details: Record<string, unknown>) {
		return [[SETTLE_REF, { ...TURN, ...details }]];
	}

	it('retries a turn that left nothing visible and answers on the second attempt', async () => {
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, NOTHING_SHOWN, ANSWERED]);

		await expect(handler._handler(ctx, TURN)).resolves.toBeNull();

		expect(streamTextMock.mock.calls.map((call) => call[2].promptMessageId)).toEqual(['m1', 'm1']);
		expect(limitMock.mock.calls.filter((call) => call[1] === 'globalLLM')).toHaveLength(2);
		expect(ctx.runMutation.mock.calls).toEqual([LAST_MESSAGE]);
		expect(vi.mocked(console.warn).mock.calls).toEqual([
			[{ code: 'support_turn_retried', threadId: 'thread_1', promptMessageId: 'm1', attempts: 2 }]
		]);
	});

	it('hands the turn to the team when neither attempt leaves anything', async () => {
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, NOTHING_SHOWN, NOTHING_SHOWN]);

		await expect(handler._handler(ctx, TURN)).resolves.toBeNull();

		expect(streamTextMock).toHaveBeenCalledTimes(2);
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'no_reply', attempts: 2, visibleText: false })
		);
	});

	// A second run would repeat what the visitor already read.
	it('does not retry a turn that showed part of an answer', async () => {
		const ctx = makeCtx(null, [...READY, PARTIAL]);

		await handler._handler(ctx, TURN);

		expect(streamTextMock).toHaveBeenCalledOnce();
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'partial_reply', attempts: 1, visibleText: true })
		);
	});

	it('retries after a provider error and settles with only its coded name and status', async () => {
		streamTextMock.mockRejectedValueOnce(
			new APICallError({
				message: 'PRIVATE_PROVIDER_BODY',
				url: 'https://provider.test/v1',
				requestBodyValues: { prompt: 'PRIVATE_PROMPT' },
				statusCode: 502
			})
		);
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, NOTHING_SHOWN, NOTHING_SHOWN]);

		await expect(handler._handler(ctx, TURN)).resolves.toBeNull();

		expect(streamTextMock).toHaveBeenCalledTimes(2);
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({
				reason: 'no_reply',
				attempts: 2,
				visibleText: false,
				errorName: 'APICallError',
				status: 502
			})
		);
		expect(JSON.stringify(ctx.runMutation.mock.calls)).not.toContain('PRIVATE_');
	});

	it.each([
		{
			label: 'an exhausted provider retry',
			thrown: new RetryError({
				message: 'PRIVATE_RETRY',
				reason: 'maxRetriesExceeded',
				errors: [
					new APICallError({
						message: 'PRIVATE_PROVIDER_BODY',
						url: 'https://provider.test/v1',
						requestBodyValues: {},
						statusCode: 503
					})
				]
			}),
			coded: { errorName: 'APICallError', status: 503 }
		},
		{
			label: 'an allowlisted name',
			thrown: Object.assign(new Error('PRIVATE_TIMEOUT'), { name: 'TimeoutError' }),
			coded: { errorName: 'TimeoutError' }
		},
		{
			label: 'any other name',
			thrown: Object.assign(new Error('PRIVATE_DETAIL'), { name: 'PRIVATE_NAME' }),
			coded: { errorName: 'other' }
		}
	])('settles $label by its coded form only', async ({ thrown, coded }) => {
		streamTextMock.mockRejectedValue(thrown);
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, NOTHING_SHOWN, NOTHING_SHOWN]);

		await handler._handler(ctx, TURN);

		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'no_reply', attempts: 2, visibleText: false, ...coded })
		);
		expect(JSON.stringify(ctx.runMutation.mock.calls)).not.toContain('PRIVATE_');
	});

	// The retry is a second full model run, so the cost budget is asked again,
	// and a refusal leaves the visitor with the team rather than with silence.
	it('hands the turn to the team when the budget refuses the retry', async () => {
		limitMock
			.mockResolvedValueOnce({ ok: true, retryAfter: 0 })
			.mockResolvedValueOnce({ ok: false, retryAfter: 5_000 });
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN]);

		await handler._handler(ctx, TURN);

		expect(streamTextMock).toHaveBeenCalledOnce();
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'retry_rate_limited', attempts: 1, visibleText: false })
		);
	});

	it('leaves a thread the team took over before the job ran', async () => {
		limitMock.mockResolvedValue({ ok: false, retryAfter: 5_000 });
		const ctx = makeCtx(null, [HANDED_OFF_SILENT]);

		await expect(handler._handler(ctx, TURN)).resolves.toBeNull();

		expect(limitMock).not.toHaveBeenCalled();
		expect(streamTextMock).not.toHaveBeenCalled();
		// Neither the agent's rate-limit copy nor a handoff: the thread is the team's.
		expect(ctx.runMutation).not.toHaveBeenCalled();
	});

	// The team can take the thread between the queued read and the model call,
	// for example while the budget and the prompt are read.
	it('starts no model run on a thread handed off right before the dispatch', async () => {
		const ctx = makeCtx(null, [NOTHING_SHOWN, HANDED_OFF_SILENT]);

		await expect(handler._handler(ctx, TURN)).resolves.toBeNull();

		expect(streamTextMock).not.toHaveBeenCalled();
		expect(recordMock).not.toHaveBeenCalled();
		expect(ctx.runMutation).not.toHaveBeenCalled();
	});

	it('starts no retry on a thread handed off after the first attempt', async () => {
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, HANDED_OFF_SILENT]);

		await handler._handler(ctx, TURN);

		expect(streamTextMock).toHaveBeenCalledOnce();
		// The first attempt still told the visitor nothing, so the settlement makes
		// sure they hear back; it writes nothing when the handoff already did.
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'handoff_without_reply', attempts: 1, visibleText: false })
		);
	});

	// request_handoff already told the team; only the visitor's reply is missing,
	// and running the agent again would talk over the people now holding the thread.
	it('settles a handoff the agent requested but never put into words', async () => {
		const ctx = makeCtx(null, [...READY, HANDED_OFF_SILENT]);

		await handler._handler(ctx, TURN);

		expect(streamTextMock).toHaveBeenCalledOnce();
		expect(ctx.runMutation.mock.calls).toEqual(
			settled({ reason: 'handoff_without_reply', attempts: 1, visibleText: false })
		);
	});

	it.each([
		{ label: 'an answer', outcome: ANSWERED },
		{ label: 'a handoff the agent explained', outcome: { ...PARTIAL, handedOff: true } }
	])('ends a first attempt that left $label without a retry or log', async ({ outcome }) => {
		const ctx = makeCtx(null, [...READY, outcome]);

		await handler._handler(ctx, TURN);

		expect(streamTextMock).toHaveBeenCalledOnce();
		expect(ctx.runMutation.mock.calls).toEqual([LAST_MESSAGE]);
		expect(console.warn).not.toHaveBeenCalled();
	});

	// One row per turn keeps the admin cost view counting turns, not attempts.
	it('records a retried turn as one usage row with each attempt counted once', async () => {
		const usage = (model: string, inputTokens: number) => ({
			model,
			inputTokens,
			outputTokens: 5,
			totalTokens: inputTokens + 5
		});
		sinkMock
			.mockImplementationOnce(() => ({
				usageHandler: vi.fn(),
				collect: () => [usage('support-model', 10)]
			}))
			.mockImplementationOnce(() => ({
				usageHandler: vi.fn(),
				collect: () => [usage('support-model', 20)]
			}));
		const ctx = makeCtx(null, [...READY, NOTHING_SHOWN, NOTHING_SHOWN, ANSWERED]);

		await handler._handler(ctx, TURN);

		expect(recordMock).toHaveBeenCalledOnce();
		expect(recordMock.mock.calls[0][1]).toEqual({
			feature: 'support_chat',
			userId: undefined,
			threadId: 'thread_1',
			status: 'ok',
			models: [{ model: 'support-model', inputTokens: 30, outputTokens: 10, totalTokens: 40 }]
		});
	});

	// A stream that returned normally used to be recorded as `ok` whatever it left.
	it.each([
		{
			label: 'nothing',
			outcomes: [...READY, NOTHING_SHOWN, NOTHING_SHOWN, NOTHING_SHOWN],
			status: 'error'
		},
		{ label: 'text short of an answer', outcomes: [...READY, PARTIAL], status: 'partial' }
	])('passes the recorder $status for a turn that left $label', async ({ outcomes, status }) => {
		const ctx = makeCtx(null, outcomes);

		await handler._handler(ctx, TURN);

		expect(recordMock.mock.calls.map((call) => call[1].status)).toEqual([status]);
	});
});

/**
 * Rows of one support thread as the agent component stores them, read through
 * a fake of its two queries. The fake follows the installed component's
 * listMessagesByThreadId: newest first by order and step, bounded to the
 * `upToAndIncludingMessageId` order when one is given, cut to `numItems`.
 */
function threadCtx(options: { handedOff: boolean; rows: MessageDoc[] }) {
	const byNewest = [...options.rows].sort((a, b) => b.order - a.order || b.stepOrder - a.stepOrder);
	return {
		db: {
			query: () => ({
				withIndex: () => ({
					first: async () => ({
						_id: 'st_1',
						threadId: 'thread_1',
						isHandedOff: options.handedOff
					})
				})
			})
		},
		runQuery: vi.fn(async (reference: string, args: Record<string, unknown>) => {
			if (reference === 'components.agent.messages.getMessagesByIds') {
				const ids = args.messageIds as string[];
				return ids.map((id) => options.rows.find((row) => row._id === id) ?? null);
			}
			if (reference === 'components.agent.messages.listMessagesByThreadId') {
				const upTo = options.rows.find((row) => row._id === args.upToAndIncludingMessageId);
				const { numItems } = args.paginationOpts as { numItems: number };
				const page = byNewest.filter((row) => !upTo || row.order <= upTo.order).slice(0, numItems);
				return { page, isDone: page.length < numItems, continueCursor: 'next' };
			}
			throw new Error(`unexpected query ${reference}`);
		})
	};
}

function row(overrides: Partial<MessageDoc> & Pick<MessageDoc, '_id' | 'order'>): MessageDoc {
	return {
		_creationTime: 1,
		threadId: 'thread_1',
		stepOrder: 0,
		status: 'success',
		tool: false,
		...overrides
	};
}

const PROMPT = row({
	_id: 'm1',
	order: 3,
	message: { role: 'user', content: 'help' },
	text: 'help'
});

/** The row a mid-stream failure leaves: the step failed after reasoning, before any text. */
const FAILED_REASONING = row({
	_id: 'a1',
	order: 3,
	stepOrder: 1,
	status: 'failed',
	error: 'Tool execution failed.',
	message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] }
});

function assistantText(id: string, order: number, status: MessageDoc['status']): MessageDoc {
	return row({
		_id: id,
		order,
		stepOrder: 2,
		status,
		message: { role: 'assistant', content: 'Here is how' },
		text: 'Here is how'
	});
}

// The visitor widget would render a failed step's reasoning; the admin
// transcript keeps it (support/messageListing.test.ts covers both readings).
it('lists the visitor thread without failed text-less agent steps', async () => {
	vi.clearAllMocks();
	const visitorList = listMessages as unknown as Fn<Record<string, unknown>, unknown>;

	await visitorList._handler(
		{},
		{ threadId: 'thread_1', paginationOpts: { numItems: 50, cursor: null } }
	);

	expect(listMessagesForThread).toHaveBeenCalledWith(
		{},
		expect.objectContaining({ threadId: 'thread_1', hideFailedTextlessAssistant: true })
	);
});

describe('getTurnOutcome', () => {
	const outcomeHandler = getTurnOutcome as unknown as Fn<
		{ threadId: string; promptMessageId: string },
		TurnOutcome
	>;
	const TURN = { threadId: 'thread_1', promptMessageId: 'm1' };

	it('reads a failed reasoning-only step as nothing shown', async () => {
		const ctx = threadCtx({ handedOff: false, rows: [PROMPT, FAILED_REASONING] });

		await expect(outcomeHandler._handler(ctx, TURN)).resolves.toEqual(NOTHING_SHOWN);
	});

	it('reads failed text as shown but not answered', async () => {
		const ctx = threadCtx({
			handedOff: true,
			rows: [PROMPT, FAILED_REASONING, assistantText('a2', 3, 'failed')]
		});

		await expect(outcomeHandler._handler(ctx, TURN)).resolves.toEqual({
			handedOff: true,
			answered: false,
			visibleText: true
		});
	});

	// Another tab can send while the turn runs. Enough later rows would fill a
	// newest-first page and hide the answer the turn did save.
	it('finds the answer behind more later rows than one page holds', async () => {
		const later = Array.from({ length: 40 }, (_, index) =>
			assistantText(`later_${index}`, 4 + index, 'success')
		);
		const ctx = threadCtx({
			handedOff: false,
			rows: [PROMPT, FAILED_REASONING, assistantText('a2', 3, 'success'), ...later]
		});

		await expect(outcomeHandler._handler(ctx, TURN)).resolves.toEqual(ANSWERED);
	});
});

describe('ensureSupportTurnSettled', () => {
	const watchdog = ensureSupportTurnSettled as unknown as Fn<
		{ threadId: string; promptMessageId: string; jobId: string; checksLeft: number },
		null
	>;
	const settleMock = settleUnanswered as unknown as ReturnType<typeof vi.fn>;
	const ENSURE_REF = 'internal.support.messages.ensureSupportTurnSettled';
	const ARGS = { threadId: 'thread_1', promptMessageId: 'm1', jobId: 'job_1', checksLeft: 2 };
	const UNANSWERED = { handedOff: false, rows: [PROMPT, FAILED_REASONING] };
	const ANSWERED_TURN = { handedOff: false, rows: [PROMPT, assistantText('a2', 3, 'success')] };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function watchdogCtx(
		job: { state: { kind: string } } | null,
		thread: { handedOff: boolean; rows: MessageDoc[] } = UNANSWERED
	) {
		const base = threadCtx(thread);
		return {
			...base,
			db: { ...base.db, system: { get: vi.fn(async () => job) } },
			scheduler: { runAfter: vi.fn() }
		};
	}

	it.each([
		{ label: 'failed', job: { state: { kind: 'failed' } }, reason: 'job_failed' },
		{ label: 'is gone from the scheduler', job: null, reason: 'job_missing' }
	])('settles an unanswered turn whose job $label', async ({ job, reason }) => {
		const ctx = watchdogCtx(job);

		await watchdog._handler(ctx, ARGS);

		expect(ctx.db.system.get).toHaveBeenCalledWith('_scheduled_functions', 'job_1');
		expect(settleMock.mock.calls).toEqual([
			[ctx, { threadId: 'thread_1', promptMessageId: 'm1', reason, visibleText: false }]
		]);
	});

	// request_handoff committed and the job then died before the model spoke.
	// The settlement owns the acknowledgement-only case (support/handoff.test.ts).
	it('settles a failed job whose handoff left the visitor without a word', async () => {
		const ctx = watchdogCtx({ state: { kind: 'failed' } }, { ...UNANSWERED, handedOff: true });

		await watchdog._handler(ctx, ARGS);

		expect(settleMock.mock.calls).toEqual([
			[
				ctx,
				{ threadId: 'thread_1', promptMessageId: 'm1', reason: 'job_failed', visibleText: false }
			]
		]);
	});

	// The job can fail on bookkeeping after the agent's answer was already saved.
	it('leaves a failed job alone when its turn was answered', async () => {
		const ctx = watchdogCtx({ state: { kind: 'failed' } }, ANSWERED_TURN);

		await watchdog._handler(ctx, ARGS);

		expect(settleMock).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
	});

	it('leaves a job that finished to the action that settled it', async () => {
		const ctx = watchdogCtx({ state: { kind: 'success' } });

		await watchdog._handler(ctx, ARGS);

		expect(ctx.runQuery).not.toHaveBeenCalled();
		expect(settleMock).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
	});

	it('looks again later while the job may still write a reply', async () => {
		const ctx = watchdogCtx({ state: { kind: 'inProgress' } });

		await watchdog._handler(ctx, ARGS);

		expect(settleMock).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter.mock.calls).toEqual([
			[3 * 60 * 1000, ENSURE_REF, { ...ARGS, checksLeft: 1 }]
		]);
	});

	// Handing off underneath a job that may still write would leave two replies.
	it.each(['inProgress', 'pending', 'canceled'])(
		'logs an error naming the thread for an unanswered %s job it stopped waiting for',
		async (kind) => {
			const ctx = watchdogCtx({ state: { kind } });

			await watchdog._handler(ctx, { ...ARGS, checksLeft: 0 });

			expect(settleMock).not.toHaveBeenCalled();
			expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
			expect(vi.mocked(console.error).mock.calls).toEqual([
				[
					{
						code: 'support_turn_unsettled',
						threadId: 'thread_1',
						promptMessageId: 'm1',
						state: kind
					}
				]
			]);
		}
	);

	// The job can still be running its bookkeeping after the reply is saved.
	it.each(['inProgress', 'canceled'])(
		'stays silent about a %s job whose turn was answered',
		async (kind) => {
			const ctx = watchdogCtx({ state: { kind } }, ANSWERED_TURN);

			await watchdog._handler(ctx, { ...ARGS, checksLeft: 0 });

			expect(settleMock).not.toHaveBeenCalled();
			expect(console.error).not.toHaveBeenCalled();
		}
	);
});

/**
 * The rate-limit notice is saved by its own mutation after the action already
 * read the thread, so the visitor can hand it over in between.
 */
describe('createAssistantMessage', () => {
	const create = createAssistantMessage as unknown as Fn<
		{ threadId: string; text: string },
		unknown
	>;
	const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;

	function ctxWithThread(isHandedOff: boolean) {
		return {
			db: {
				query: () => ({
					withIndex: () => ({ first: async () => ({ threadId: 'thread_1', isHandedOff }) })
				})
			}
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('writes nothing on a thread the team holds', async () => {
		await create._handler(ctxWithThread(true), { threadId: 'thread_1', text: 'busy' });

		expect(saveMessageMock).not.toHaveBeenCalled();
	});

	it('saves the message while the agent holds the thread', async () => {
		await create._handler(ctxWithThread(false), { threadId: 'thread_1', text: 'busy' });

		expect(saveMessageMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				threadId: 'thread_1',
				message: { role: 'assistant', content: 'busy' }
			})
		);
	});
});
