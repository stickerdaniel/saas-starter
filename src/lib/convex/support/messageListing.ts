import {
	listMessages,
	syncStreams,
	toUIMessages,
	type SyncStreamsReturnValue,
	type UIMessage
} from '@convex-dev/agent';
import type { MessageDoc, StreamMessage } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import {
	combineStreamingUIMessages,
	deriveUIMessagesFromDeltas
} from '../../chat/core/stream-materialization';
import type { ChatMessage, MessagesQueryResponse } from '../../chat/core/types';
import {
	redactMessageDocToolErrors,
	redactStreamDeltas,
	redactUIMessageToolErrors
} from '../../chat/core/tool-error-redaction';

type MessagePaginationArgs = {
	numItems: number;
	cursor: string | null;
};

type MessageStreamArgs =
	| {
			kind: 'list';
			startOrder?: number;
	  }
	| {
			kind: 'deltas';
			cursors: Array<{
				streamId: string;
				cursor: number;
			}>;
	  };

/**
 * One page of a thread for the support widget, the admin transcript, and the
 * AI chat.
 *
 * `hideFailedTextlessAssistant` is the support visitor's option. An agent step
 * that failed before it wrote any text leaves an assistant row holding only its
 * reasoning; the widget would render that reasoning, and the row would merge
 * into the retry's reply on the same order. The admin transcript keeps the row
 * as the evidence of what failed.
 *
 * The rows are dropped from the page the cursor was built over, so a page can
 * hold fewer items than requested and the widget's first page shows that many
 * fewer older messages. Accepted because a turn leaves such a row only when a
 * model step fails mid-stream.
 */
export async function listMessagesForThread(
	ctx: QueryCtx,
	args: {
		threadId: string;
		paginationOpts: MessagePaginationArgs;
		streamArgs?: MessageStreamArgs;
		hideFailedTextlessAssistant?: boolean;
	}
): Promise<MessagesQueryResponse> {
	const rawPaginated = await listMessages(ctx, components.agent, {
		threadId: args.threadId,
		paginationOpts: args.paginationOpts
	});
	const rawPage = args.hideFailedTextlessAssistant
		? rawPaginated.page.filter((doc) => !isFailedTextlessAssistant(doc))
		: rawPaginated.page;
	const redactedMessages = rawPage.map(redactMessageDocToolErrors);
	const paginated = { ...rawPaginated, page: toUIMessages(redactedMessages) };

	const metadataMap = new Map<string, Record<string, unknown>>();
	for (const rawMessage of redactedMessages) {
		if (rawMessage.provider || rawMessage.providerMetadata) {
			metadataMap.set(rawMessage._id, {
				provider: rawMessage.provider,
				providerMetadata: rawMessage.providerMetadata
			});
		}
	}

	const enrichedPage = paginated.page.map((message) =>
		redactUIMessageToolErrors({
			...message,
			metadata: metadataMap.get(message.id)
		})
	);

	const streamArgs =
		args.streamArgs?.kind === 'list'
			? {
					kind: 'list' as const,
					startOrder: args.streamArgs.startOrder ?? 0
				}
			: (args.streamArgs ?? { kind: 'list' as const, startOrder: 0 });

	const syncedStreams = await syncStreams(ctx, components.agent, {
		threadId: args.threadId,
		streamArgs,
		includeStatuses: ['streaming', 'finished', 'aborted']
	});
	const streams: SyncStreamsReturnValue =
		syncedStreams?.kind === 'deltas'
			? { ...syncedStreams, deltas: redactStreamDeltas(syncedStreams.deltas) }
			: syncedStreams;

	if (streams?.kind !== 'list' || args.paginationOpts.numItems === 0) {
		return { ...paginated, page: enrichedPage, streams };
	}

	// Only materialize ACTIVE streams over the historical page. Once a stream
	// is finished/aborted, the persisted MessageDoc rows are authoritative
	// (toUIMessages already sets state='output-available' for completed tool
	// calls). Materializing finished streams was clobbering that with the
	// in-flight stream snapshot, leaving renderUI stuck at input-streaming
	// even though the result was saved.
	const activeStreamMessages = (streams.messages ?? []).filter(
		(streamMessage) => streamMessage.status === 'streaming'
	);
	const materializedPage =
		activeStreamMessages.length === 0
			? enrichedPage
			: await mergeRecentStreamsIntoPage(ctx, {
					threadId: args.threadId,
					page: enrichedPage,
					streamMessages: activeStreamMessages
				});

	const liveStreams = {
		kind: 'list' as const,
		messages: activeStreamMessages
	};

	return { ...paginated, page: materializedPage, streams: liveStreams };
}

function isFailedTextlessAssistant(doc: MessageDoc): boolean {
	return doc.status === 'failed' && doc.message?.role === 'assistant' && !doc.text?.trim();
}

async function mergeRecentStreamsIntoPage(
	ctx: QueryCtx,
	args: {
		threadId: string;
		page: ChatMessage[];
		streamMessages: StreamMessage[];
	}
): Promise<ChatMessage[]> {
	if (args.streamMessages.length === 0) {
		return args.page;
	}

	const deltas = redactStreamDeltas(
		await ctx.runQuery(components.agent.streams.listDeltas, {
			threadId: args.threadId,
			cursors: args.streamMessages.map((streamMessage) => ({
				streamId: streamMessage.streamId,
				cursor: 0
			}))
		})
	);

	const materializedStreams = combineStreamingUIMessages(
		await deriveUIMessagesFromDeltas(args.threadId, args.streamMessages, deltas)
	).map(redactUIMessageToolErrors);
	return mergeMaterializedStreamsIntoPage(args.page, materializedStreams);
}

export function mergeMaterializedStreamsIntoPage(
	page: ChatMessage[],
	materializedStreams: UIMessage[]
): ChatMessage[] {
	const streamedByOrder = new Map(materializedStreams.map((message) => [message.order, message]));

	return page.map((message) => {
		if (message.role !== 'assistant') {
			return message;
		}

		const materialized = streamedByOrder.get(message.order);
		if (!materialized) {
			return message;
		}

		return mergeAssistantMessage(message, materialized);
	});
}

export function mergeAssistantMessage(message: ChatMessage, materialized: UIMessage): ChatMessage {
	return {
		...message,
		status: materialized.status,
		text: materialized.text,
		parts: materialized.parts,
		agentName: materialized.agentName ?? message.agentName
	};
}
