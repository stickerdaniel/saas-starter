<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { onDestroy, type Snippet } from 'svelte';
	import type { UIMessage } from '@convex-dev/agent';
	import type { ChatSessionPort } from '../core/chat-session-port.js';
	import { CHAT_PAGE_SIZE, type DisplayMessage, type ChatMessagesQuery } from '../core/types.js';
	import {
		ChatUIContext,
		setChatUIContext,
		type UploadConfig,
		type ChatAlignment
	} from './chat-context.svelte.ts';
	import {
		buildDisplayMessages,
		dedupeChatDisplayMessages,
		decodeStreamingUIMessages,
		getActiveStreamIds,
		getListStreamMessages,
		getNormalizedMessages,
		getStreamDeltas,
		hasAssistantResponseStarted
	} from './streaming-display.js';
	import { syncReasoningAccordionState } from './reasoning-accordion-sync.js';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';

	let {
		threadId,
		api,
		externalCore,
		externalUIContext,
		uploadConfig,
		listMessagesArgs,
		userAlignment = 'right',
		pageSize = CHAT_PAGE_SIZE,
		children
	}: {
		/** Thread ID (required for loading messages) */
		threadId: string | null;
		/** Read-only message subscriptions; the sending surface owns its command API. */
		api: {
			listMessages: ChatMessagesQuery;
		};
		/** Chat session state owned by the embedding surface. */
		externalCore: ChatSessionPort;
		/** External UI context (optional - if provided, uses existing context) */
		externalUIContext?: ChatUIContext;
		/** Upload configuration for file attachments */
		uploadConfig?: UploadConfig;
		/** Additional args for the listMessages query */
		listMessagesArgs?: { anonymousUserId?: string };
		/** User message alignment - 'right' (default) or 'left' for admin view */
		userAlignment?: ChatAlignment;
		/** Number of messages per page */
		pageSize?: number;
		/** Child components */
		children: Snippet;
	} = $props();

	// Get Convex client
	const client = useConvexClient();

	// Core ownership is fixed for the component lifetime; swapping requires remount.
	// svelte-ignore state_referenced_locally
	const core: ChatSessionPort = externalCore;

	// Create and set UI context (use external if provided)
	// Context object is created once and placed in Svelte context.
	// svelte-ignore state_referenced_locally
	const uiContext =
		externalUIContext ??
		new ChatUIContext(core, client, uploadConfig, userAlignment, activeUploadsContext.getOr(null));
	setChatUIContext(uiContext);

	// Dispose the internally created context on unmount (revokes blob preview
	// URLs of unsent attachments). External contexts are owned by their creator.
	onDestroy(() => {
		if (!externalUIContext) uiContext.dispose();
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
		return getActiveStreamIds(getListStreamMessages(messagesQuery.data));
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
		return getNormalizedMessages(messagesQuery.data);
	});

	const streamMessages = $derived.by(() => {
		return getListStreamMessages(messagesQuery.data);
	});

	const allDeltas = $derived.by(() => {
		return getStreamDeltas(deltasQuery.data);
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

	// Clear awaiting state once an assistant response becomes visible. The usual
	// reply starts a stream, while terminal system notices arrive without one.
	$effect(() => {
		if (!core.isAwaitingStream) return;
		if (hasAssistantResponseStarted(renderDisplayMessages)) {
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
