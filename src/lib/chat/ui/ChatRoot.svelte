<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import type { Snippet } from 'svelte';
	import type { PaginationResult } from 'convex/server';
	import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';
	import type { UIMessage } from '@convex-dev/agent';
	import { ChatCore, type ChatCoreAPI } from '../core/ChatCore.svelte.js';
	import type { ChatMessage, DisplayMessage } from '../core/types.js';
	import {
		combineStreamingUIMessages,
		deriveUIMessagesFromDeltas,
		extractReasoning,
		normalizeMessage
	} from '../core/StreamProcessor.js';
	import {
		transformToDisplayMessage,
		transformToDisplayMessageSimple,
		type TransformContext,
		dedupeDisplayMessagesForRender
	} from '../core/DisplayMessageProcessor.js';
	import {
		ChatUIContext,
		setChatUIContext,
		type UploadConfig,
		type ChatAlignment
	} from './ChatContext.svelte.js';
	import { getActiveStreamingReasoningIndex, getReasoningPartKey } from './reasoning-parts.js';

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
		setAwaitingStream: (awaiting: boolean) => void;
		streamCache: ChatCore['streamCache'];
	}

	let {
		threadId,
		api,
		externalCore,
		externalUIContext,
		uploadConfig,
		listMessagesArgs,
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
		externalCore?: ExternalCoreAdapter | ChatCore;
		/** External UI context (optional - if provided, uses existing context) */
		externalUIContext?: ChatUIContext;
		/** Upload configuration for file attachments */
		uploadConfig?: UploadConfig;
		/** Additional args for the listMessages query */
		listMessagesArgs?: Record<string, unknown>;
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
	// Intentional mount-time config capture; threadId is synced later via $effect.
	// svelte-ignore state_referenced_locally
	const internalCore = externalCore
		? null
		: new ChatCore({
				threadId,
				api
			});

	// Use either external or internal core
	// Core selection is fixed for component lifetime; swapping requires remount.
	// svelte-ignore state_referenced_locally
	const core = (externalCore as unknown as ChatCore) ?? internalCore!;

	// Create and set UI context (use external if provided)
	// Context object is created once and placed in Svelte context.
	// svelte-ignore state_referenced_locally
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
	// API reference is stable for component lifetime; threadId is reactive in the closure.
	// svelte-ignore state_referenced_locally
	const messagesQuery = useQuery(api.listMessages, () =>
		threadId
			? {
					threadId: threadId,
					...listMessagesArgs,
					paginationOpts: { numItems: pageSize, cursor: null },
					streamArgs: { kind: 'list' as const, startOrder: 0 }
				}
			: 'skip'
	);

	// Extract active stream IDs for delta query
	const activeStreamIds = $derived.by(() => {
		const messagesData = messagesQuery.data as MessagesQueryResponse | undefined;
		return messagesData?.streams?.kind === 'list'
			? (messagesData.streams.messages || [])
					.filter(
						(m) => m.status === 'streaming' || m.status === 'finished' || m.status === 'aborted'
					)
					.map((m) => m.streamId)
			: [];
	});

	// Second query: Get text deltas for active streams
	// svelte-ignore state_referenced_locally
	const deltasQuery = useQuery(api.listMessages, () =>
		threadId && activeStreamIds.length > 0
			? {
					threadId: threadId,
					...listMessagesArgs,
					paginationOpts: { numItems: 0, cursor: null },
					streamArgs: {
						kind: 'deltas' as const,
						cursors: activeStreamIds.map((streamId: string) => ({
							streamId,
							cursor: 0
						}))
					}
				}
			: 'skip'
	);

	// Get messages from query - optimistic updates are handled by Convex's store.setQuery
	// When a mutation calls createOptimisticUpdate(), the query cache is updated immediately
	// and automatically reverts if the mutation fails
	const allMessages = $derived.by(() => {
		const messagesData = messagesQuery.data as MessagesQueryResponse | undefined;
		const queryMessages = messagesData?.page || [];

		// Normalize messages to ensure top-level role exists
		return queryMessages.map((msg) => normalizeMessage(msg));
	});

	const streamMessages = $derived.by(() => {
		const messagesData = messagesQuery.data as MessagesQueryResponse | undefined;
		return messagesData?.streams?.kind === 'list' ? messagesData.streams.messages || [] : [];
	});

	const allDeltas = $derived.by(() => {
		const deltasData = deltasQuery.data as MessagesQueryResponse | undefined;
		return deltasData?.streams?.kind === 'deltas'
			? ((deltasData.streams.deltas || []) as StreamDelta[])
			: [];
	});

	let streamingUIMessages: UIMessage[] = $state([]);

	$effect(() => {
		const currentThreadId = threadId;
		const currentStreamMessages = streamMessages;
		const currentDeltas = allDeltas;
		let cancelled = false;

		if (!currentThreadId || currentStreamMessages.length === 0) {
			streamingUIMessages = [];
			return;
		}

		void (async () => {
			try {
				const decodedMessages = await deriveUIMessagesFromDeltas(
					currentThreadId,
					currentStreamMessages,
					currentDeltas
				);
				if (cancelled) return;
				streamingUIMessages = combineStreamingUIMessages(decodedMessages);
			} catch (error) {
				if (cancelled) return;
				console.error('Failed to decode streaming UI messages', error);
				streamingUIMessages = [];
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// Process streaming deltas to create display messages
	const displayMessages = $derived.by((): DisplayMessage[] => {
		// Fast path: no active streams
		if (streamMessages.length === 0) {
			return allMessages.map((msg) => transformToDisplayMessageSimple(msg));
		}

		// Build streaming data maps - local processing, not reactive state
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local data processing
		const streamPartsMap = new Map<string, UIMessage['parts']>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local data processing
		const streamTextMap = new Map<number, string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local data processing
		const streamReasoningMap = new Map<number, string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local data processing
		const streamStatusMap = new Map<number, string>();

		[...streamMessages]
			.sort((a, b) => {
				if (a.order !== b.order) return a.order - b.order;
				return a.stepOrder - b.stepOrder;
			})
			.forEach((streamMsg) => {
				streamStatusMap.set(streamMsg.order, streamMsg.status);
				core.streamCache.updateStatusCache(streamMsg.order, streamMsg.status);
			});

		streamingUIMessages.forEach((uiMsg: UIMessage) => {
			streamPartsMap.set(`${uiMsg.order}-${uiMsg.stepOrder ?? 0}`, uiMsg.parts || []);
			streamTextMap.set(uiMsg.order, uiMsg.text || '');
			const reasoning = extractReasoning(uiMsg.parts || []);
			if (reasoning) {
				streamReasoningMap.set(uiMsg.order, reasoning);
				core.streamCache.updateReasoningCache(uiMsg.order, reasoning);
			}
		});

		// Build streaming keys set for message identification
		const streamingKeys = new Set(
			streamingUIMessages.map((uiMsg) => `${uiMsg.order}-${uiMsg.stepOrder ?? 0}`)
		);

		// Transform context for message processing
		const context: TransformContext = {
			streamingKeys,
			streamPartsMap,
			streamTextMap,
			streamReasoningMap,
			streamStatusMap,
			streamCache: core.streamCache
		};

		return allMessages.map((msg) => transformToDisplayMessage(msg, context));
	});

	// Update UI context with display messages
	$effect(() => {
		// Defensive UI guard: query/stream reconciliation should not duplicate IDs, but collapse any
		// transient duplicates here so keyed message rendering cannot crash.
		uiContext.setDisplayMessages(dedupeDisplayMessagesForRender(displayMessages));
	});

	// Track when messages query has resolved (prevents suggestion chip flash)
	const messagesReady = $derived(messagesQuery.data !== undefined);
	$effect(() => {
		uiContext.setMessagesReady(messagesReady);
	});

	// Clear awaiting state when NEW streaming assistant message appears
	// (not based on hasActiveStreams which includes old finished streams)
	$effect(() => {
		const hasStreamingAssistant = displayMessages.some(
			(m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
		);

		if (hasStreamingAssistant && core.isAwaitingStream) {
			core.setAwaitingStream(false);
		}
	});

	// Auto-manage reasoning accordion state for interleaved reasoning/tool/text parts.
	// Only the last overall part can be considered the active streaming reasoning part.
	$effect(() => {
		displayMessages.forEach((message) => {
			const parts = message.parts ?? [];

			if (parts.length > 0) {
				const isMessageInProgress = message.status === 'pending' || message.status === 'streaming';
				const activeReasoningIndex = getActiveStreamingReasoningIndex(parts, isMessageInProgress);

				parts.forEach((part, idx) => {
					if (part.type !== 'reasoning') return;
					const partKey = `${message.id}:${getReasoningPartKey(idx)}`;

					if (idx === activeReasoningIndex) {
						if (!uiContext.isReasoningOpen(partKey)) {
							uiContext.setReasoningOpen(partKey, true);
							uiContext.markAutoOpened(partKey);
						}
					} else if (uiContext.wasAutoOpened(partKey)) {
						uiContext.setReasoningOpen(partKey, false);
						uiContext.clearAutoOpened(partKey);
					}
				});
			} else {
				// Fallback: message-level reasoning state for messages without parts
				const hasReasoning = !!message.displayReasoning;
				const hasResponse = !!message.displayText;

				if (hasReasoning && !hasResponse) {
					uiContext.setReasoningOpen(message.id, true);
					uiContext.markAutoOpened(message.id);
				} else if (hasResponse && uiContext.wasAutoOpened(message.id)) {
					uiContext.setReasoningOpen(message.id, false);
					uiContext.clearAutoOpened(message.id);
				}
			}
		});
	});
</script>

{@render children()}
