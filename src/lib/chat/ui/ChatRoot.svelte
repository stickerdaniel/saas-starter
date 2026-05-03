<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import type { Snippet } from 'svelte';
	import type { UIMessage } from '@convex-dev/agent';
	import { ChatCore, type ChatCoreAPI } from '../core/ChatCore.svelte.js';
	import type { ChatMessage, DisplayMessage } from '../core/types.js';
	import {
		ChatUIContext,
		setChatUIContext,
		type UploadConfig,
		type ChatAlignment
	} from './ChatContext.svelte.js';
	import {
		buildDisplayMessages,
		dedupeChatDisplayMessages,
		decodeStreamingUIMessages,
		getActiveStreamIds,
		getListStreamMessages,
		getNormalizedMessages,
		getStreamDeltas,
		hasStreamingAssistantMessage,
		type MessagesQueryResponse
	} from './streaming-display.js';
	import { syncReasoningAccordionState } from './reasoning-accordion-sync.js';

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
		return getActiveStreamIds(
			getListStreamMessages(messagesQuery.data as MessagesQueryResponse | undefined)
		);
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
		return getNormalizedMessages(messagesQuery.data as MessagesQueryResponse | undefined);
	});

	const streamMessages = $derived.by(() => {
		return getListStreamMessages(messagesQuery.data as MessagesQueryResponse | undefined);
	});

	const allDeltas = $derived.by(() => {
		return getStreamDeltas(deltasQuery.data as MessagesQueryResponse | undefined);
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
				const decodedMessages = await decodeStreamingUIMessages(
					currentThreadId,
					currentStreamMessages,
					currentDeltas
				);
				if (cancelled) return;
				streamingUIMessages = decodedMessages;
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

	const renderDisplayMessages = $derived.by((): DisplayMessage[] =>
		dedupeChatDisplayMessages(
			buildDisplayMessages({
				allMessages,
				streamMessages,
				streamingUIMessages,
				streamCache: core.streamCache
			})
		)
	);

	// Update UI context with display messages
	$effect(() => {
		// Defensive UI guard: query/stream reconciliation should not duplicate IDs, but collapse any
		// transient duplicates here so keyed message rendering cannot crash.
		uiContext.setDisplayMessages(renderDisplayMessages);
	});

	// Track when messages query has resolved (prevents suggestion chip flash)
	const messagesReady = $derived(messagesQuery.data !== undefined);
	$effect(() => {
		uiContext.setMessagesReady(messagesReady);
	});

	// Clear awaiting state when NEW streaming assistant message appears
	// (not based on hasActiveStreams which includes old finished streams)
	$effect(() => {
		if (hasStreamingAssistantMessage(renderDisplayMessages) && core.isAwaitingStream) {
			core.setAwaitingStream(false);
		}
	});

	// Auto-manage reasoning accordion state for interleaved reasoning/tool/text parts.
	// Only the last overall part can be considered the active streaming reasoning part.
	$effect(() => {
		syncReasoningAccordionState(renderDisplayMessages, uiContext);
	});
</script>

{@render children()}
