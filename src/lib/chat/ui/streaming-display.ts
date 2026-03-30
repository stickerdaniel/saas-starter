import type { PaginationResult } from 'convex/server';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';
import type { ChatMessage, DisplayMessage } from '../core/types.js';
import { extractReasoning, normalizeMessage } from '../core/message-extraction.js';
import {
	combineStreamingUIMessages,
	deriveUIMessagesFromDeltas
} from '../core/stream-materialization.js';
import {
	dedupeDisplayMessagesForRender,
	transformToDisplayMessage,
	type TransformContext
} from '../core/DisplayMessageProcessor.js';
import type { StreamCacheManager } from '../core/stream-cache.js';

export type MessagesQueryResponse = PaginationResult<ChatMessage> & {
	streams: {
		kind: 'list' | 'deltas';
		messages?: StreamMessage[];
		deltas?: StreamDelta[];
	};
};

export function getNormalizedMessages(
	messagesData: MessagesQueryResponse | undefined
): ChatMessage[] {
	return (messagesData?.page ?? []).map((message) => normalizeMessage(message));
}

export function getListStreamMessages(
	messagesData: MessagesQueryResponse | undefined
): StreamMessage[] {
	return messagesData?.streams?.kind === 'list' ? (messagesData.streams.messages ?? []) : [];
}

export function getStreamDeltas(messagesData: MessagesQueryResponse | undefined): StreamDelta[] {
	return messagesData?.streams?.kind === 'deltas'
		? ((messagesData.streams.deltas ?? []) as StreamDelta[])
		: [];
}

export function getActiveStreamIds(streamMessages: StreamMessage[]): string[] {
	return streamMessages
		.filter(
			(streamMessage) =>
				streamMessage.status === 'streaming' ||
				streamMessage.status === 'finished' ||
				streamMessage.status === 'aborted'
		)
		.map((streamMessage) => streamMessage.streamId);
}

export async function decodeStreamingUIMessages(
	threadId: string,
	streamMessages: StreamMessage[],
	allDeltas: StreamDelta[]
): Promise<UIMessage[]> {
	const decodedMessages = await deriveUIMessagesFromDeltas(threadId, streamMessages, allDeltas);
	return combineStreamingUIMessages(decodedMessages);
}

export function buildTransformContext(args: {
	streamMessages: StreamMessage[];
	streamingUIMessages: UIMessage[];
	streamCache: StreamCacheManager;
}): TransformContext {
	const streamMessageMap = new Map<number, UIMessage>();

	[...args.streamMessages]
		.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return a.stepOrder - b.stepOrder;
		})
		.forEach((streamMessage) => {
			args.streamCache.updateStatusCache(streamMessage.order, streamMessage.status);
		});

	args.streamingUIMessages.forEach((uiMessage) => {
		streamMessageMap.set(uiMessage.order, uiMessage);
		const reasoning = extractReasoning(uiMessage.parts);
		if (reasoning) {
			args.streamCache.updateReasoningCache(uiMessage.order, reasoning);
		}
	});

	return {
		streamMessageMap,
		streamCache: args.streamCache
	};
}

export function buildDisplayMessages(args: {
	allMessages: ChatMessage[];
	streamMessages: StreamMessage[];
	streamingUIMessages: UIMessage[];
	streamCache: StreamCacheManager;
}): DisplayMessage[] {
	const context = buildTransformContext({
		streamMessages: args.streamMessages,
		streamingUIMessages: args.streamingUIMessages,
		streamCache: args.streamCache
	});

	const assistantOrders = new Set(
		args.allMessages
			.filter((message) => message.role === 'assistant')
			.map((message) => message.order)
	);

	const streamOnlyMessages = args.streamingUIMessages
		.filter((uiMessage) => !assistantOrders.has(uiMessage.order))
		.map((uiMessage) => createStreamOnlyChatMessage(uiMessage));

	return [...args.allMessages, ...streamOnlyMessages]
		.sort((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			return a._creationTime - b._creationTime;
		})
		.map((message) => transformToDisplayMessage(message, context));
}

function createStreamOnlyChatMessage(uiMessage: UIMessage): ChatMessage {
	return {
		id: uiMessage.id,
		_creationTime: uiMessage._creationTime,
		key: uiMessage.key,
		role: 'assistant',
		status: uiMessage.status,
		order: uiMessage.order,
		stepOrder: uiMessage.stepOrder,
		text: uiMessage.text,
		parts: uiMessage.parts as ChatMessage['parts'],
		agentName: uiMessage.agentName,
		metadata: uiMessage.metadata as Record<string, unknown> | undefined
	};
}

export function dedupeChatDisplayMessages(messages: DisplayMessage[]): DisplayMessage[] {
	return dedupeDisplayMessagesForRender(messages);
}

export function hasStreamingAssistantMessage(messages: DisplayMessage[]): boolean {
	return messages.some(
		(message) =>
			message.role === 'assistant' &&
			(message.status === 'pending' || message.status === 'streaming')
	);
}
