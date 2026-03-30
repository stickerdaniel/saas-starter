import { listUIMessages, syncStreams } from '@convex-dev/agent';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import {
	combineStreamingUIMessages,
	deriveUIMessagesFromDeltas
} from '../../chat/core/stream-materialization';
import type { ChatMessage } from '../../chat/core/types';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamMessage } from '@convex-dev/agent/validators';

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

type RawMessageRow = {
	_id: string;
	provider?: string;
	providerMetadata?: Record<string, unknown>;
};

export async function listMessagesForThread(
	ctx: QueryCtx,
	args: {
		threadId: string;
		paginationOpts: MessagePaginationArgs;
		streamArgs?: MessageStreamArgs;
	}
): Promise<unknown> {
	const paginated = await listUIMessages(ctx, components.agent, {
		threadId: args.threadId,
		paginationOpts: args.paginationOpts
	});

	let rawMessages: { page: Array<RawMessageRow> } = {
		page: []
	};
	if (args.paginationOpts.numItems > 0) {
		rawMessages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			order: 'asc'
		});
	}

	const metadataMap = new Map<string, Record<string, unknown>>();
	for (const rawMsg of rawMessages.page) {
		if (rawMsg.provider || rawMsg.providerMetadata) {
			metadataMap.set(rawMsg._id, {
				provider: rawMsg.provider,
				providerMetadata: rawMsg.providerMetadata
			});
		}
	}

	const enrichedPage = paginated.page.map((msg) => ({
		...msg,
		metadata: metadataMap.get(msg.id)
	}));

	const streamArgs =
		args.streamArgs?.kind === 'list'
			? {
					kind: 'list' as const,
					startOrder: args.streamArgs.startOrder ?? 0
				}
			: (args.streamArgs ?? { kind: 'list' as const, startOrder: 0 });

	const streams = await syncStreams(ctx, components.agent, {
		threadId: args.threadId,
		streamArgs,
		includeStatuses: ['streaming', 'finished', 'aborted']
	});

	if (streams?.kind !== 'list' || args.paginationOpts.numItems === 0) {
		return { ...paginated, page: enrichedPage, streams };
	}

	const materializedPage = await mergeRecentStreamsIntoPage(ctx, {
		threadId: args.threadId,
		page: enrichedPage,
		streamMessages: streams.messages ?? []
	});

	const liveStreams = {
		kind: 'list' as const,
		messages: (streams.messages ?? []).filter(
			(streamMessage) => streamMessage.status === 'streaming'
		)
	};

	return { ...paginated, page: materializedPage, streams: liveStreams };
}

async function mergeRecentStreamsIntoPage(
	ctx: QueryCtx,
	args: {
		threadId: string;
		page: Array<ChatMessage>;
		streamMessages: StreamMessage[];
	}
): Promise<Array<ChatMessage>> {
	if (args.streamMessages.length === 0) {
		return args.page;
	}

	const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
		threadId: args.threadId,
		cursors: args.streamMessages.map((streamMessage) => ({
			streamId: streamMessage.streamId,
			cursor: 0
		}))
	});

	const materializedStreams = combineStreamingUIMessages(
		await deriveUIMessagesFromDeltas(args.threadId, args.streamMessages, deltas)
	);
	return mergeMaterializedStreamsIntoPage(args.page, materializedStreams);
}

export function mergeMaterializedStreamsIntoPage(
	page: Array<ChatMessage>,
	materializedStreams: Array<UIMessage>
): Array<ChatMessage> {
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
		parts: materialized.parts as ChatMessage['parts'],
		agentName: materialized.agentName ?? message.agentName
	};
}
