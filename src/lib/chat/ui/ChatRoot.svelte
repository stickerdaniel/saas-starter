<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import type { Snippet } from 'svelte';
	import type { PaginationResult } from 'convex/server';
	import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';
	import type { UIMessage } from '@convex-dev/agent';
	import { ChatCore, type ChatCoreAPI } from '../core/ChatCore.svelte.js';
	import type { ChatMessage, DisplayMessage } from '../core/types.js';
	import {
		deriveUIMessagesFromTextStreamParts,
		extractReasoning,
		extractUserMessageText,
		normalizeMessage
	} from '../core/StreamProcessor.js';
	import { ChatUIContext, setChatUIContext } from './ChatContext.svelte.js';

	// Type for the query response with streams
	type MessagesQueryResponse = PaginationResult<ChatMessage> & {
		streams: {
			kind: 'list' | 'deltas';
			messages?: StreamMessage[];
			deltas?: StreamDelta[];
		};
	};

	/**
	 * External core adapter interface
	 *
	 * When using an external state manager (like SupportThreadContext),
	 * provide an adapter that maps to the ChatCore interface.
	 */
	export interface ExternalCoreAdapter {
		threadId: string | null;
		messages: ChatMessage[];
		isLoading: boolean;
		isSending: boolean;
		error: string | null;
		isAwaitingStream: boolean;
		optimisticMessages: ChatMessage[];
		setAwaitingStream: (awaiting: boolean) => void;
		streamCache: ChatCore['streamCache'];
	}

	let {
		threadId,
		api,
		externalCore,
		pageSize = 50,
		children
	}: {
		/** Thread ID (required for loading messages) */
		threadId: string | null;
		/** Convex API endpoints */
		api: ChatCoreAPI & {
			listMessages: Parameters<typeof useQuery>[0];
		};
		/** External core adapter (optional - if provided, uses external state) */
		externalCore?: ExternalCoreAdapter;
		/** Number of messages per page */
		pageSize?: number;
		/** Child components */
		children: Snippet;
	} = $props();

	// Get Convex client
	const client = useConvexClient();

	// Create ChatCore instance (only if not using external core)
	const internalCore = externalCore
		? null
		: new ChatCore({
				threadId,
				api
			});

	// Use either external or internal core
	const core = (externalCore as unknown as ChatCore) ?? internalCore!;

	// Create and set UI context
	const uiContext = new ChatUIContext(core, client);
	setChatUIContext(uiContext);

	// Update core threadId when prop changes (only for internal core)
	$effect(() => {
		if (internalCore && internalCore.threadId !== threadId) {
			internalCore.setThread(threadId);
		}
	});

	// Query messages with streamArgs for streaming support
	const messagesQuery = $derived(
		threadId
			? useQuery(api.listMessages, {
					threadId: threadId,
					paginationOpts: { numItems: pageSize, cursor: null },
					streamArgs: { kind: 'list' as const, startOrder: 0 }
				})
			: undefined
	);

	// Extract active stream IDs for delta query
	const activeStreamIds = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		return messagesData?.streams?.kind === 'list'
			? (messagesData.streams.messages || [])
					.filter(
						(m) => m.status === 'streaming' || m.status === 'finished' || m.status === 'aborted'
					)
					.map((m) => m.streamId)
			: [];
	});

	// Second query: Get text deltas for active streams
	const deltasQuery = $derived(
		threadId && activeStreamIds.length > 0
			? useQuery(api.listMessages, {
					threadId: threadId,
					paginationOpts: { numItems: 0, cursor: null },
					streamArgs: {
						kind: 'deltas' as const,
						cursors: activeStreamIds.map((streamId: string) => ({
							streamId,
							cursor: 0
						}))
					}
				})
			: undefined
	);

	// Merge query messages with optimistic messages from core
	const allMessages = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		const queryMessages = messagesData?.page || [];
		const optimisticMessages = core.optimisticMessages;

		// Normalize message to ensure top-level role exists
		const messageMap = new Map<string, ChatMessage>();

		// Add query messages first (normalized)
		for (const msg of queryMessages) {
			messageMap.set(msg.id, normalizeMessage(msg));
		}

		// Add optimistic messages that don't have real versions yet (normalized)
		// Match by text content, not by ID or position
		for (const msg of optimisticMessages) {
			// Check if there's a real message with matching text and role
			const hasRealMatch = queryMessages.some((qm) => qm.role === msg.role && qm.text === msg.text);

			if (hasRealMatch) {
				continue;
			}

			// No real match yet, keep the optimistic message
			if (!messageMap.has(msg.id)) {
				messageMap.set(msg.id, normalizeMessage(msg));
			}
		}

		return Array.from(messageMap.values()).sort((a, b) => a._creationTime - b._creationTime);
	});

	// Process streaming deltas to create display messages
	const displayMessages = $derived.by((): DisplayMessage[] => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		const deltasData = deltasQuery?.data as MessagesQueryResponse | undefined;

		const streamMessages =
			messagesData?.streams?.kind === 'list' ? messagesData.streams.messages || [] : [];

		const allDeltas =
			deltasData?.streams?.kind === 'deltas'
				? ((deltasData.streams.deltas || []) as StreamDelta[])
				: [];

		if (streamMessages.length === 0) {
			// No streams visible - use cached state for stability
			return allMessages.map((msg) => {
				const isUser = msg.role === 'user';
				let displayText = '';
				if (isUser) {
					displayText = extractUserMessageText(msg);
				} else {
					displayText = msg.text || '';
				}

				const reasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';
				const cachedStatus = core.streamCache.getCachedStatus(msg.order);

				return {
					...msg,
					displayText,
					displayReasoning: reasoning,
					isStreaming: cachedStatus === 'streaming',
					hasReasoningStream: core.streamCache.hasStatusCache(msg.order)
				};
			});
		}

		// Process streams with delta processing
		const [streamingUIMessages] = deriveUIMessagesFromTextStreamParts(
			threadId!,
			streamMessages,
			[],
			allDeltas
		);

		// Build maps of order -> streaming text, reasoning, and status
		const streamingTextMap = new Map<number, string>();
		const streamingReasoningMap = new Map<number, string>();
		const streamingStatusMap = new Map<number, string>();

		// Map stream messages by order to get status
		streamMessages.forEach((streamMsg) => {
			streamingStatusMap.set(streamMsg.order, streamMsg.status);
			core.streamCache.updateStatusCache(streamMsg.order, streamMsg.status);
		});

		streamingUIMessages.forEach((uiMsg: UIMessage) => {
			streamingTextMap.set(uiMsg.order, uiMsg.text || '');
			const reasoning = extractReasoning(uiMsg.parts || []);
			if (reasoning) {
				streamingReasoningMap.set(uiMsg.order, reasoning);
				core.streamCache.updateReasoningCache(uiMsg.order, reasoning);
			}
		});

		// Merge streaming data with messages
		return allMessages.map((msg) => {
			const streamText = streamingTextMap.get(msg.order);
			const streamReasoning = streamingReasoningMap.get(msg.order);
			const streamStatus = streamingStatusMap.get(msg.order);
			const isStreaming = streamStatus === 'streaming';
			const hasReasoningStream = streamStatus !== undefined;

			const isUser = msg.role === 'user';
			let displayText = '';
			if (isUser) {
				displayText = extractUserMessageText(msg);
			} else {
				displayText = streamText || msg.text || '';
			}

			// Three-tier fallback for reasoning
			const persistedReasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';
			const cachedReasoning = core.streamCache.getCachedReasoning(msg.order) || '';
			const currentReasoning = streamReasoning || persistedReasoning;
			const displayReasoning = currentReasoning || cachedReasoning;

			// Update cache
			if (currentReasoning) {
				core.streamCache.updateReasoningCache(msg.order, currentReasoning);
			}

			// Clear cache once persisted reasoning exists
			if (persistedReasoning && cachedReasoning && !streamReasoning) {
				core.streamCache.clearReasoningCache(msg.order);
			}

			return {
				...msg,
				displayText,
				displayReasoning,
				isStreaming,
				hasReasoningStream
			};
		});
	});

	// Update UI context with display messages
	$effect(() => {
		uiContext.setDisplayMessages(displayMessages);
	});

	// Check for active streams
	const hasActiveStreams = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		if (messagesData?.streams?.kind !== 'list') return false;
		const arr = messagesData.streams?.messages || [];
		return arr.length > 0;
	});

	// Clear awaiting state when streams arrive
	$effect(() => {
		if (hasActiveStreams) {
			core.setAwaitingStream(false);
			return;
		}
		const last = displayMessages.length ? displayMessages[displayMessages.length - 1] : undefined;
		if (last && last.role === 'assistant' && (last.displayText || last.displayReasoning)) {
			core.setAwaitingStream(false);
		}
	});

	// Auto-manage reasoning accordion state
	$effect(() => {
		displayMessages.forEach((message) => {
			const hasReasoning = !!message.displayReasoning;
			const hasResponse = !!message.displayText;

			// Auto-open when reasoning arrives without response
			if (hasReasoning && !hasResponse) {
				uiContext.setReasoningOpen(message.id, true);
			}
			// Auto-close when response starts
			else if (hasResponse && uiContext.isReasoningOpen(message.id)) {
				uiContext.setReasoningOpen(message.id, false);
			}
		});
	});
</script>

{@render children()}
