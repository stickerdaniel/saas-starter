/**
 * Optimistic Update Helpers
 *
 * Provides helper functions for creating optimistic updates using Convex's
 * built-in `store.setQuery` API. This approach automatically handles rollback
 * on mutation failure without manual try/catch logic.
 *
 * @see https://docs.convex.dev/client/react/optimistic-updates
 */

import type { OptimisticLocalStore } from 'convex/browser';
import type { FunctionReference, PaginationResult } from 'convex/server';
import type { ChatMessage, Attachment } from './types.js';

/**
 * Query args shape for listMessages queries
 */
export interface ListMessagesArgs {
	threadId: string | null;
	paginationOpts: { numItems: number; cursor: string | null };
	streamArgs: { kind: 'list'; startOrder: number };
}

/**
 * Query result shape for listMessages queries (paginated with streams)
 */
export interface ListMessagesResult extends PaginationResult<ChatMessage> {
	streams: {
		kind: 'list' | 'deltas';
		messages?: unknown[];
		deltas?: unknown[];
	};
}

/**
 * Options for creating optimistic messages
 */
export interface OptimisticMessageOptions {
	/** Local attachments for upload preview */
	attachments?: Attachment[];
	/** Additional metadata to merge with { optimistic: true } */
	metadata?: Record<string, unknown>;
}

/**
 * Create an optimistic message object
 *
 * @param threadId - The thread ID
 * @param role - Message role ('user' or 'assistant')
 * @param content - Message text content
 * @param order - Message order (typically current page length)
 * @param options - Optional attachments and metadata
 * @returns A ChatMessage object suitable for optimistic display
 *
 * @example
 * ```typescript
 * // User message with attachments
 * const msg = createOptimisticMessage(threadId, 'user', 'Hello', 0, {
 *   attachments: [{ type: 'image', url: '...', filename: 'photo.jpg' }]
 * });
 *
 * // Admin reply with provider metadata
 * const msg = createOptimisticMessage(threadId, 'assistant', 'Hi there', 1, {
 *   metadata: { provider: 'human' }
 * });
 * ```
 */
export function createOptimisticMessage(
	threadId: string,
	role: 'user' | 'assistant',
	content: string,
	order: number,
	options?: OptimisticMessageOptions
): ChatMessage {
	const messageId = `temp_${crypto.randomUUID()}`;
	console.log('[Optimistic] Creating optimistic message:', {
		id: messageId,
		threadId,
		role,
		content: content.substring(0, 50),
		order
	});

	return {
		id: messageId,
		_creationTime: Date.now(),
		threadId,
		role,
		message: { role, content },
		text: content,
		status: 'success',
		order,
		tool: false,
		metadata: { ...options?.metadata, optimistic: true },
		localAttachments: options?.attachments?.length ? options.attachments : undefined
	};
}

/**
 * Create an optimistic update callback for message mutations
 *
 * This function returns a callback that can be passed to `client.mutation()`
 * as the `optimisticUpdate` option. It will:
 * 1. Find the current query result for listMessages
 * 2. Append an optimistic message to the page
 * 3. Automatically roll back if the mutation fails
 *
 * @param listMessagesQuery - The listMessages function reference
 * @param queryArgs - The exact args used for the active query
 * @param role - Message role ('user' or 'assistant')
 * @param prompt - The message text content
 * @param options - Optional attachments and metadata
 * @returns An optimistic update callback
 *
 * @example
 * ```typescript
 * // User sending a message
 * await client.mutation(
 *   api.support.messages.sendMessage,
 *   { threadId, prompt },
 *   {
 *     optimisticUpdate: createOptimisticUpdate(
 *       api.support.messages.listMessages,
 *       { threadId, paginationOpts: { numItems: 50, cursor: null }, streamArgs: { kind: 'list', startOrder: 0 } },
 *       'user',
 *       prompt,
 *       { attachments }
 *     )
 *   }
 * );
 *
 * // Admin sending a reply
 * await client.mutation(
 *   api.admin.support.mutations.sendAdminReply,
 *   { threadId, prompt },
 *   {
 *     optimisticUpdate: createOptimisticUpdate(
 *       api.support.messages.listMessages,
 *       queryArgs,
 *       'assistant',
 *       prompt,
 *       { metadata: { provider: 'human' } }
 *     )
 *   }
 * );
 * ```
 */
export function createOptimisticUpdate(
	listMessagesQuery: FunctionReference<'query'>,
	queryArgs: ListMessagesArgs,
	role: 'user' | 'assistant',
	prompt: string,
	options?: OptimisticMessageOptions
): (store: OptimisticLocalStore) => void {
	console.log(
		'[Optimistic] createOptimisticUpdate - preparing callback for threadId:',
		queryArgs.threadId
	);

	return (store: OptimisticLocalStore) => {
		console.log(
			'[Optimistic] Optimistic callback invoked, querying store for:',
			queryArgs.threadId
		);

		const current = store.getQuery(listMessagesQuery, queryArgs);

		// Type guard: ensure valid pagination result
		// If query isn't in cache yet, return early - use context-based optimistic messages instead
		if (
			!current ||
			typeof current !== 'object' ||
			!('page' in current) ||
			!Array.isArray(current.page)
		) {
			console.log(
				'[Optimistic] Query not in cache or invalid structure, skipping optimistic update'
			);
			return;
		}

		console.log('[Optimistic] Current page length:', current.page.length);

		const optimisticMessage = createOptimisticMessage(
			queryArgs.threadId!,
			role,
			prompt,
			current.page.length,
			options
		);

		console.log(
			'[Optimistic] Updating store with new optimistic message, new page length:',
			current.page.length + 1
		);

		store.setQuery(listMessagesQuery, queryArgs, {
			...current,
			page: [...current.page, optimisticMessage]
		});

		console.log('[Optimistic] Store updated successfully');
	};
}
