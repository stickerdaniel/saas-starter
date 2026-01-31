/**
 * Unit tests for optimistic update helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOptimisticMessage, createOptimisticUpdate } from './optimistic.js';
import type { FunctionReference } from 'convex/server';
import type { OptimisticLocalStore } from 'convex/browser';
import type { ListMessagesArgs } from './optimistic.js';

describe('createOptimisticMessage', () => {
	it('creates a user message with required fields', () => {
		const msg = createOptimisticMessage('thread-123', 'user', 'Hello', 0);

		expect(msg.threadId).toBe('thread-123');
		expect(msg.role).toBe('user');
		expect(msg.text).toBe('Hello');
		expect(msg.order).toBe(0);
		expect(msg.status).toBe('success');
		expect(msg.tool).toBe(false);
		expect(msg.id).toMatch(/^temp_/);
		expect(msg._creationTime).toBeGreaterThan(0);
		expect(msg.message).toEqual({ role: 'user', content: 'Hello' });
	});

	it('creates an assistant message', () => {
		const msg = createOptimisticMessage('thread-123', 'assistant', 'Hi there', 1);

		expect(msg.role).toBe('assistant');
		expect(msg.text).toBe('Hi there');
		expect(msg.order).toBe(1);
		expect(msg.message).toEqual({ role: 'assistant', content: 'Hi there' });
	});

	it('always sets optimistic: true in metadata', () => {
		const msg = createOptimisticMessage('thread-123', 'user', 'Hello', 0);

		expect(msg.metadata?.optimistic).toBe(true);
	});

	it('merges custom metadata with optimistic flag', () => {
		const msg = createOptimisticMessage('thread-123', 'assistant', 'Hi', 0, {
			metadata: { provider: 'human', customField: 'value' }
		});

		expect(msg.metadata).toEqual({
			provider: 'human',
			customField: 'value',
			optimistic: true
		});
	});

	it('prevents caller from overriding optimistic flag', () => {
		const msg = createOptimisticMessage('thread-123', 'user', 'Hello', 0, {
			metadata: { optimistic: false }
		});

		// optimistic: true should always win (comes last in spread)
		expect(msg.metadata?.optimistic).toBe(true);
	});

	it('includes attachments when provided', () => {
		const attachments = [
			{ type: 'image' as const, url: 'https://example.com/img.jpg', filename: 'photo.jpg' }
		];
		const msg = createOptimisticMessage('thread-123', 'user', 'Check this', 0, { attachments });

		expect(msg.localAttachments).toEqual(attachments);
	});

	it('passes through empty attachments array (sanitization handled by caller)', () => {
		const msg = createOptimisticMessage('thread-123', 'user', 'Hello', 0, { attachments: [] });

		// createOptimisticMessage is a low-level function that expects pre-sanitized input
		// sanitizeAttachmentsForClone() in createOptimisticUpdate handles empty array → undefined
		expect(msg.localAttachments).toEqual([]);
	});

	it('generates unique IDs for each message', () => {
		const msg1 = createOptimisticMessage('thread-123', 'user', 'Hello', 0);
		const msg2 = createOptimisticMessage('thread-123', 'user', 'Hello', 0);

		expect(msg1.id).not.toBe(msg2.id);
	});
});

describe('createOptimisticUpdate', () => {
	let getQueryMock: ReturnType<typeof vi.fn>;
	let setQueryMock: ReturnType<typeof vi.fn>;
	let mockStore: OptimisticLocalStore;
	let mockQuery: FunctionReference<'query'>;
	let queryArgs: ListMessagesArgs;

	beforeEach(() => {
		getQueryMock = vi.fn();
		setQueryMock = vi.fn();
		mockStore = {
			getQuery: getQueryMock,
			setQuery: setQueryMock
		} as unknown as OptimisticLocalStore;

		mockQuery = {} as FunctionReference<'query'>;

		queryArgs = {
			threadId: 'thread-123',
			paginationOpts: { numItems: 50, cursor: null },
			streamArgs: { kind: 'list' as const, startOrder: 0 }
		};
	});

	it('appends optimistic message to existing page', () => {
		const existingPage = [{ id: 'msg-1', role: 'user', text: 'First message' }];
		getQueryMock.mockReturnValue({
			page: existingPage,
			isDone: false,
			continueCursor: null
		});

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'New message');
		updateFn(mockStore);

		expect(getQueryMock).toHaveBeenCalledWith(mockQuery, queryArgs);
		expect(setQueryMock).toHaveBeenCalledWith(
			mockQuery,
			queryArgs,
			expect.objectContaining({
				page: expect.arrayContaining([
					existingPage[0],
					expect.objectContaining({
						role: 'user',
						text: 'New message',
						metadata: { optimistic: true }
					})
				])
			})
		);
	});

	it('sets order based on current page length', () => {
		getQueryMock.mockReturnValue({
			page: [{ id: 'msg-1' }, { id: 'msg-2' }, { id: 'msg-3' }],
			isDone: false,
			continueCursor: null
		});

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Fourth message');
		updateFn(mockStore);

		expect(setQueryMock).toHaveBeenCalledWith(
			mockQuery,
			queryArgs,
			expect.objectContaining({
				page: expect.arrayContaining([
					expect.objectContaining({
						order: 3,
						text: 'Fourth message'
					})
				])
			})
		);
	});

	it('no-ops when query result is undefined', () => {
		getQueryMock.mockReturnValue(undefined);

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Hello');
		updateFn(mockStore);

		expect(setQueryMock).not.toHaveBeenCalled();
	});

	it('no-ops when query result is null', () => {
		getQueryMock.mockReturnValue(null);

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Hello');
		updateFn(mockStore);

		expect(setQueryMock).not.toHaveBeenCalled();
	});

	it('no-ops when query result has no page array', () => {
		getQueryMock.mockReturnValue({ something: 'else' });

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Hello');
		updateFn(mockStore);

		expect(setQueryMock).not.toHaveBeenCalled();
	});

	it('no-ops when page is not an array', () => {
		getQueryMock.mockReturnValue({ page: 'not an array' });

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Hello');
		updateFn(mockStore);

		expect(setQueryMock).not.toHaveBeenCalled();
	});

	it('passes attachments through to optimistic message', () => {
		const attachments = [
			{
				type: 'file' as const,
				name: 'doc.pdf',
				size: 1024,
				mimeType: 'application/pdf',
				url: 'https://example.com/doc.pdf'
			}
		];
		getQueryMock.mockReturnValue({
			page: [],
			isDone: true,
			continueCursor: null
		});

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Check this file', {
			attachments
		});
		updateFn(mockStore);

		expect(setQueryMock).toHaveBeenCalledWith(
			mockQuery,
			queryArgs,
			expect.objectContaining({
				page: expect.arrayContaining([
					expect.objectContaining({
						localAttachments: attachments
					})
				])
			})
		);
	});

	it('passes metadata through to optimistic message', () => {
		getQueryMock.mockReturnValue({
			page: [],
			isDone: true,
			continueCursor: null
		});

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'assistant', 'Admin reply', {
			metadata: { provider: 'human' }
		});
		updateFn(mockStore);

		expect(setQueryMock).toHaveBeenCalledWith(
			mockQuery,
			queryArgs,
			expect.objectContaining({
				page: expect.arrayContaining([
					expect.objectContaining({
						metadata: { provider: 'human', optimistic: true }
					})
				])
			})
		);
	});

	it('preserves other fields from existing query result', () => {
		getQueryMock.mockReturnValue({
			page: [],
			isDone: false,
			continueCursor: 'cursor-123',
			streams: { kind: 'list', messages: [] }
		});

		const updateFn = createOptimisticUpdate(mockQuery, queryArgs, 'user', 'Hello');
		updateFn(mockStore);

		expect(setQueryMock).toHaveBeenCalledWith(
			mockQuery,
			queryArgs,
			expect.objectContaining({
				isDone: false,
				continueCursor: 'cursor-123',
				streams: { kind: 'list', messages: [] }
			})
		);
	});
});
