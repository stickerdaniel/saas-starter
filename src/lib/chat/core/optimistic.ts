/**
 * Optimistic updates through Convex's `store.setQuery`, which rolls the update
 * back when the mutation fails.
 *
 * @see https://docs.convex.dev/client/react/optimistic-updates
 */

import type { OptimisticLocalStore } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { ChatMessage, Attachment } from './types.js';

export interface ListMessagesArgs {
	threadId: string | null;
	anonymousUserId?: string;
	paginationOpts: { numItems: number; cursor: string | null };
	streamArgs: { kind: 'list'; startOrder: number };
}

export interface OptimisticMessageOptions {
	attachments?: Attachment[];
	/** Merged with { optimistic: true } */
	metadata?: Record<string, unknown>;
}

/**
 * Removes the fields an optimistic clone cannot carry.
 *
 * Convex's data layer cannot serialize File or Blob values, which reach the
 * server only through file storage. Svelte 5 `$state` proxies fail
 * structuredClone. A JSON round-trip unwraps the proxies after the File and
 * Blob fields are dropped. In .svelte and .svelte.ts files, `$state.snapshot()`
 * at the call site is the better tool.
 */
function sanitizeAttachmentsForClone(attachments?: Attachment[]): Attachment[] | undefined {
	if (!attachments?.length) return undefined;

	const serializableAttachments = attachments.map((att) => {
		if (att.type === 'file') {
			// Omit 'file' (File object) and 'preview' (blob: URL that the composer
			// revokes on clear; the optimistic clone renders from the uploaded 'url')
			const { file: _file, preview: _preview, ...rest } = att;
			return rest;
		} else if (att.type === 'screenshot') {
			// Omit 'blob' (Blob object) and 'preview' (revoked blob: URL, see above)
			const { blob: _blob, preview: _preview, ...rest } = att;
			return rest;
		}
		return att;
	});

	// The JSON round-trip breaks every Svelte 5 $state proxy wrapper
	return JSON.parse(JSON.stringify(serializableAttachments)) as Attachment[];
}

/**
 * @param order - The order the backend will assign, see `nextMessageOrder`
 * @param options - Attachments and metadata, already sanitized by the caller
 */
export function createOptimisticMessage(
	threadId: string,
	role: 'user' | 'assistant',
	content: string,
	order: number,
	options?: OptimisticMessageOptions
): ChatMessage {
	const messageId = `temp_${crypto.randomUUID()}`;

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
		localAttachments: options?.attachments
	};
}

/**
 * The order the agent gives the next prompt: one past the highest order in the
 * thread. Orders are thread-wide and the first page holds the newest messages,
 * so its highest order is the thread's, while its length is unrelated to it.
 */
function nextMessageOrder(page: ReadonlyArray<Pick<ChatMessage, 'order'>>): number {
	return Math.max(-1, ...page.map(({ order }) => order)) + 1;
}

/**
 * Returns an `optimisticUpdate` callback for `client.mutation()`. It appends the
 * message to the active listMessages page at the next thread order, and Convex
 * rolls it back when the mutation fails.
 *
 * @param queryArgs - The exact args of the active query, e.g.
 *   `{ threadId, paginationOpts: { numItems: CHAT_PAGE_SIZE, cursor: null }, streamArgs }`
 *
 * @example
 * ```typescript
 * await client.mutation(api.support.messages.sendMessage, { threadId, prompt }, {
 *   optimisticUpdate: createOptimisticUpdate(
 *     api.support.messages.listMessages, queryArgs, 'user', prompt, { attachments }
 *   )
 * });
 * ```
 */
export function createOptimisticUpdate(
	listMessagesQuery: FunctionReference<'query'>,
	queryArgs: ListMessagesArgs,
	role: 'user' | 'assistant',
	prompt: string,
	options?: OptimisticMessageOptions
): (store: OptimisticLocalStore) => void {
	// Sanitize before the closure captures the options: Svelte 5 $state proxies
	// cannot be cloned by structuredClone.
	let sanitizedOptions: OptimisticMessageOptions | undefined;
	try {
		sanitizedOptions = options
			? {
					metadata: options.metadata
						? (JSON.parse(JSON.stringify(options.metadata)) as Record<string, unknown>)
						: undefined,
					attachments: sanitizeAttachmentsForClone(options.attachments)
				}
			: undefined;
	} catch {
		// Sanitization fails on circular refs or BigInt; the optimistic message then
		// omits attachments and metadata
		console.error('[Optimistic.sanitizeOptions] Failed');
		sanitizedOptions = undefined;
	}

	return (store: OptimisticLocalStore) => {
		const current = store.getQuery(listMessagesQuery, queryArgs);

		// A query not yet in the cache gets no optimistic message; the server response
		// shows it.
		if (
			!current ||
			typeof current !== 'object' ||
			!('page' in current) ||
			!Array.isArray(current.page)
		) {
			return;
		}

		const optimisticMessage = createOptimisticMessage(
			queryArgs.threadId!,
			role,
			prompt,
			nextMessageOrder(current.page),
			sanitizedOptions
		);

		store.setQuery(listMessagesQuery, queryArgs, {
			...current,
			page: [...current.page, optimisticMessage]
		});
	};
}
