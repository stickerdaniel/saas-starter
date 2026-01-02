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
		normalizeMessage
	} from '../core/StreamProcessor.js';
	import {
		transformToDisplayMessage,
		transformToDisplayMessageSimple,
		type TransformContext
	} from '../core/DisplayMessageProcessor.js';
	import {
		ChatUIContext,
		setChatUIContext,
		type UploadConfig,
		type ChatAlignment
	} from './ChatContext.svelte.js';

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
		externalUIContext,
		uploadConfig,
		userAlignment = 'right',
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
		/** External UI context (optional - if provided, uses existing context) */
		externalUIContext?: ChatUIContext;
		/** Upload configuration for file attachments */
		uploadConfig?: UploadConfig;
		/** User message alignment - 'right' (default) or 'left' for admin view */
		userAlignment?: ChatAlignment;
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

	// Create and set UI context (use external if provided)
	const uiContext =
		externalUIContext ?? new ChatUIContext(core, client, uploadConfig, userAlignment);
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

	// Build optimistic ID → real message ID mapping for stable render keys
	// This prevents DOM element destruction when optimistic messages are replaced by real ones
	const optimisticKeyMap = $derived.by(() => {
		const messagesData = messagesQuery?.data as MessagesQueryResponse | undefined;
		const queryMessages = messagesData?.page || [];
		const optimisticMessages = core.optimisticMessages;

		const map = new Map<string, string>();
		const matchedOptimisticIds = new Set<string>();

		for (const msg of queryMessages) {
			const match = optimisticMessages.find(
				(opt) => !matchedOptimisticIds.has(opt.id) && opt.role === msg.role && opt.text === msg.text
			);
			if (match) {
				// Real message should use optimistic ID as render key
				map.set(msg.id, match.id);
				matchedOptimisticIds.add(match.id);
			}
		}
		return map;
	});

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

		// Fast path: no active streams
		if (streamMessages.length === 0) {
			return allMessages.map((msg) => transformToDisplayMessageSimple(msg, optimisticKeyMap));
		}

		// Process streams with delta processing
		const allDeltas =
			deltasData?.streams?.kind === 'deltas'
				? ((deltasData.streams.deltas || []) as StreamDelta[])
				: [];

		const [streamingUIMessages] = deriveUIMessagesFromTextStreamParts(
			threadId!,
			streamMessages,
			[],
			allDeltas
		);

		// Build streaming data maps
		const streamTextMap = new Map<number, string>();
		const streamReasoningMap = new Map<number, string>();
		const streamStatusMap = new Map<number, string>();

		streamMessages.forEach((streamMsg) => {
			streamStatusMap.set(streamMsg.order, streamMsg.status);
			core.streamCache.updateStatusCache(streamMsg.order, streamMsg.status);
		});

		streamingUIMessages.forEach((uiMsg: UIMessage) => {
			streamTextMap.set(uiMsg.order, uiMsg.text || '');
			const reasoning = extractReasoning(uiMsg.parts || []);
			if (reasoning) {
				streamReasoningMap.set(uiMsg.order, reasoning);
				core.streamCache.updateReasoningCache(uiMsg.order, reasoning);
			}
		});

		// Build streaming keys set for message identification
		const streamingKeys = new Set(streamMessages.map((s) => `${s.order}-${s.stepOrder}`));

		// Transform context for message processing
		const context: TransformContext = {
			streamingKeys,
			streamTextMap,
			streamReasoningMap,
			streamStatusMap,
			optimisticKeyMap,
			streamCache: core.streamCache
		};

		return allMessages.map((msg) => transformToDisplayMessage(msg, context));
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
