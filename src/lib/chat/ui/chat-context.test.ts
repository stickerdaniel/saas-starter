/**
 * Unit tests for ChatUIContext attachment cleanup
 *
 * Covers blob preview URL revocation in removeAttachment, clearAttachments,
 * and dispose so unsent attachment previews do not leak until page unload.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChatUIContext } from './chat-context.svelte.ts';
import type { ChatCore } from '../core/chat-core.svelte.ts';
import type { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';

const mockCore = {} as ChatCore;
const mockClient = {} as ConvexClient;

function fileAttachment(preview?: string): Attachment {
	return {
		type: 'file',
		key: crypto.randomUUID(),
		name: 'doc.png',
		size: 1024,
		mimeType: 'image/png',
		preview,
		uploadState: { status: 'success', progress: 100, fileId: 'file-1' }
	};
}

function screenshotAttachment(preview?: string): Attachment {
	return {
		type: 'screenshot',
		key: crypto.randomUUID(),
		name: 'shot.png',
		size: 2048,
		mimeType: 'image/png',
		preview,
		uploadState: { status: 'success', progress: 100, fileId: 'file-2' }
	};
}

describe('ChatUIContext attachment cleanup', () => {
	let revokeSpy: ReturnType<typeof vi.spyOn>;

	beforeAll(() => {
		// jsdom does not implement createObjectURL/revokeObjectURL
		if (!('revokeObjectURL' in URL)) {
			Object.defineProperty(URL, 'revokeObjectURL', {
				value: () => {},
				writable: true,
				configurable: true
			});
		}
	});

	beforeEach(() => {
		revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	});

	afterEach(() => {
		revokeSpy.mockRestore();
	});

	it('revokes the blob preview when removing an attachment', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([fileAttachment('blob:http://localhost/a')]);

		ctx.removeAttachment(0);

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/a');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('revokes all blob previews when clearing attachments', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([
			fileAttachment('blob:http://localhost/a'),
			screenshotAttachment('blob:http://localhost/b')
		]);

		ctx.clearAttachments();

		expect(revokeSpy).toHaveBeenCalledTimes(2);
		expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/a');
		expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/b');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('revokes remaining blob previews on dispose', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([screenshotAttachment('blob:http://localhost/c')]);

		ctx.dispose();

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/c');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('skips attachments without a blob preview', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([
			fileAttachment(undefined),
			fileAttachment('https://example.com/not-a-blob.png')
		]);

		ctx.clearAttachments();

		expect(revokeSpy).not.toHaveBeenCalled();
		expect(ctx.attachments).toHaveLength(0);
	});

	it('tolerates attachments that never started an upload', () => {
		// Attachments can arrive from outside with no key (handleSend restores
		// them after a failed send), so releasing them must not assume one.
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([{ type: 'image', url: 'https://example.com/a.png' }]);

		expect(() => ctx.clearAttachments()).not.toThrow();
		expect(ctx.attachments).toHaveLength(0);
	});
});

describe('ChatUIContext upload failures', () => {
	const uploadConfig = {
		generateUploadUrl: 'generateUploadUrl' as never,
		saveUploadedFile: 'saveUploadedFile' as never
	};

	/** A client whose presign step fails, so no transport stub is needed. */
	function failingClient(): ConvexClient {
		return {
			mutation: vi.fn(async () => {
				throw new Error('Rate limit exceeded');
			}),
			action: vi.fn()
		} as unknown as ConvexClient;
	}

	function succeedingClient(): ConvexClient {
		return {
			mutation: vi.fn(async () => ({ uploadUrl: 'https://storage.test', uploadToken: 't' })),
			action: vi.fn(async () => ({ fileId: 'file-9', url: 'https://cdn.test/file-9' }))
		} as unknown as ConvexClient;
	}

	/** Transport stub that succeeds; the Convex client decides the outcome. */
	function stubTransport() {
		const handlers: Record<string, () => void> = {};
		const xhr = {
			status: 200,
			responseText: JSON.stringify({ storageId: 'storage-9' }),
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				handlers[event] = handler;
			},
			open: () => {},
			setRequestHeader: () => {},
			abort: () => handlers.abort?.(),
			send: () => handlers.load?.()
		};
		vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
			return xhr;
		});
	}

	const textFile = () => new File(['hello'], 'notes.txt', { type: 'text/plain' });

	/** Upload state of the only attachment, narrowed out of the Attachment union. */
	function soleUploadState(ctx: ChatUIContext) {
		const attachment = ctx.attachments[0];
		if (!attachment || (attachment.type !== 'file' && attachment.type !== 'screenshot')) {
			throw new Error('expected a single file or screenshot attachment');
		}
		return attachment.uploadState;
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps a failed upload visible instead of removing it', async () => {
		const ctx = new ChatUIContext(mockCore, failingClient(), uploadConfig);

		await ctx.uploadFile(textFile(), 'notes.txt');

		expect(ctx.attachments).toHaveLength(1);
		expect(soleUploadState(ctx)).toMatchObject({ status: 'error', error: 'server' });
	});

	it('blocks sending while an upload has failed', async () => {
		const ctx = new ChatUIContext(mockCore, failingClient(), uploadConfig);
		ctx.setInputValue('here is the file');

		await ctx.uploadFile(textFile(), 'notes.txt');

		expect(ctx.hasFailedUploads).toBe(true);
		expect(ctx.canSend).toBe(false);
	});

	it('allows sending again once the failed attachment is discarded', async () => {
		const ctx = new ChatUIContext(mockCore, failingClient(), uploadConfig);
		ctx.setInputValue('here is the file');
		await ctx.uploadFile(textFile(), 'notes.txt');

		ctx.removeAttachment(0);

		expect(ctx.canSend).toBe(true);
	});

	it('retries with the same payload and succeeds', async () => {
		stubTransport();
		const client = succeedingClient();
		// Fail once, then let the same client succeed on the retry.
		let firstCall = true;
		client.mutation = vi.fn(async () => {
			if (firstCall) {
				firstCall = false;
				throw new Error('Rate limit exceeded');
			}
			return { uploadUrl: 'https://storage.test', uploadToken: 't' };
		}) as never;
		const ctx = new ChatUIContext(mockCore, client, uploadConfig);
		await ctx.uploadFile(textFile(), 'notes.txt');

		ctx.retryUpload(0);
		await vi.waitFor(() => {
			expect(soleUploadState(ctx)?.status).toBe('success');
		});

		expect(ctx.canSend).toBe(false); // no input text yet
		expect(ctx.hasFailedUploads).toBe(false);
	});

	it('lets a second retry supersede a slow first one', async () => {
		// Double-clicking retry must not leave the earlier attempt able to stamp
		// its own outcome over the newer one.
		stubTransport();
		const client = succeedingClient();
		let attempt = 0;
		let releaseFirst: (() => void) | undefined;
		client.mutation = vi.fn(async () => {
			attempt++;
			if (attempt === 1) throw new Error('Rate limit exceeded');
			if (attempt === 2) {
				// Hold the second attempt open until the third has settled.
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
				throw new Error('Rate limit exceeded');
			}
			return { uploadUrl: 'https://storage.test', uploadToken: 't' };
		}) as never;
		const ctx = new ChatUIContext(mockCore, client, uploadConfig);
		await ctx.uploadFile(textFile(), 'notes.txt');

		ctx.retryUpload(0); // stalls
		await vi.waitFor(() => expect(attempt).toBe(2));
		ctx.retryUpload(0); // supersedes
		await vi.waitFor(() => expect(soleUploadState(ctx)?.status).toBe('success'));

		// Let the superseded attempt finish failing. Its outcome must be dropped,
		// not written over the success that already landed.
		releaseFirst?.();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(soleUploadState(ctx)?.status).toBe('success');
		expect(ctx.hasFailedUploads).toBe(false);
	});

	it('does not upload when the attachment is removed during preprocessing', async () => {
		// Preprocessing is awaited and cannot be canceled, so the composer may be
		// empty by the time it resolves. Uploading anyway would store a file
		// nothing references.
		stubTransport();
		const client = succeedingClient();
		const ctx = new ChatUIContext(mockCore, client, uploadConfig);

		let removeDuringPreprocess: (() => void) | undefined;
		const preprocessing = new Promise<void>((resolve) => {
			removeDuringPreprocess = resolve;
		});
		const upload = ctx.uploadFile(textFile(), 'notes.txt', {
			preprocess: async (input) => {
				await preprocessing;
				return { blob: input, mimeType: 'text/plain', filename: 'notes.txt' };
			}
		});

		await vi.waitFor(() => expect(ctx.attachments).toHaveLength(1));
		ctx.removeAttachment(0);
		removeDuringPreprocess?.();
		await upload;

		expect(ctx.attachments).toHaveLength(0);
		expect(client.mutation).not.toHaveBeenCalled();
	});

	it('does nothing when retrying an attachment with no retained payload', () => {
		const ctx = new ChatUIContext(mockCore, succeedingClient(), uploadConfig);
		ctx.addAttachments([fileAttachment(undefined)]);

		expect(() => ctx.retryUpload(0)).not.toThrow();
	});

	it('aborts the in-flight upload when the attachment is removed', async () => {
		const abort = vi.fn();
		const originalAbort = AbortController.prototype.abort;
		AbortController.prototype.abort = function patchedAbort(this: AbortController, reason) {
			abort();
			return originalAbort.call(this, reason);
		};

		try {
			// A client that never settles keeps the upload in flight for removal.
			const client = {
				mutation: vi.fn(() => new Promise(() => {})),
				action: vi.fn()
			} as unknown as ConvexClient;
			const ctx = new ChatUIContext(mockCore, client, uploadConfig);
			void ctx.uploadFile(textFile(), 'notes.txt');
			await vi.waitFor(() => expect(ctx.attachments).toHaveLength(1));

			ctx.removeAttachment(0);

			expect(abort).toHaveBeenCalled();
			expect(ctx.attachments).toHaveLength(0);
		} finally {
			AbortController.prototype.abort = originalAbort;
		}
	});
});
