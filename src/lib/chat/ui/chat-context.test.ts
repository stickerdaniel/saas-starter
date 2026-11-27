/**
 * Unit tests for ChatUIContext attachment cleanup
 *
 * Covers blob preview URL revocation in removeAttachment, clearAttachments,
 * and dispose so unsent attachment previews do not leak until page unload.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { toast } from 'svelte-sonner';
import { ChatComposer } from './chat-composer.svelte.ts';
import { ChatUIContext } from './chat-context.svelte.ts';
import { createChatSession } from '../__tests__/session-fixture';
import type { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$app/env/public', () => ({ PUBLIC_CONVEX_SITE_URL: 'https://site.test' }));
vi.mock('../../auth-client.js', () => ({
	authClient: { convex: { token: async () => ({ data: { token: 'jwt-1' }, error: null }) } }
}));

const mockCore = createChatSession();
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
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer());
		ctx.addAttachments([fileAttachment('blob:http://localhost/a')]);

		ctx.removeAttachment(0);

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/a');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('revokes all blob previews when clearing attachments', () => {
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer());
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
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer());
		ctx.addAttachments([screenshotAttachment('blob:http://localhost/c')]);

		ctx.dispose();

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/c');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('skips attachments without a blob preview', () => {
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer());
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
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer());
		ctx.addAttachments([{ type: 'image', url: 'https://example.com/a.png' }]);

		expect(() => ctx.clearAttachments()).not.toThrow();
		expect(ctx.attachments).toHaveLength(0);
	});
});

describe('ChatUIContext upload failures', () => {
	const uploadConfig = { purpose: 'aiChat' } as const;

	type Answer = { status: number; body: unknown };
	const refused: Answer = {
		status: 429,
		body: { code: 'FILE_UPLOAD_RATE_LIMITED', retryAfter: 1_000 }
	};
	const accepted: Answer = {
		status: 200,
		body: { fileId: 'file-9', url: 'https://cdn.test/file-9', isImage: false }
	};

	/** The upload route answers each attempt in order, then accepts the rest. */
	function scriptRoute(...answers: Array<Answer | Promise<Answer>>) {
		const opened = vi.fn();
		vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
			const handlers: Record<string, () => void> = {};
			const xhr = {
				status: 0,
				responseText: '',
				upload: { addEventListener: () => {} },
				addEventListener: (event: string, handler: () => void) => {
					handlers[event] = handler;
				},
				open: opened,
				setRequestHeader: () => {},
				abort: () => handlers.abort?.(),
				send: () => {
					void Promise.resolve(answers.shift() ?? accepted).then(({ status, body }) => {
						xhr.status = status;
						xhr.responseText = JSON.stringify(body);
						handlers.load?.();
					});
				}
			};
			return xhr;
		});
		return opened;
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

	beforeEach(() => {
		vi.mocked(toast.error).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps a failed upload visible instead of removing it', async () => {
		scriptRoute(refused);
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);

		await ctx.uploadFile(textFile(), 'notes.txt');

		expect(ctx.attachments).toHaveLength(1);
		expect(soleUploadState(ctx)).toMatchObject({ status: 'error', error: 'server' });
	});

	it('blocks sending while an upload has failed', async () => {
		scriptRoute(refused);
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
		ctx.setInputValue('here is the file');

		await ctx.uploadFile(textFile(), 'notes.txt');

		expect(ctx.hasFailedUploads).toBe(true);
		expect(ctx.canSend).toBe(false);
	});

	it('allows sending again once the failed attachment is discarded', async () => {
		scriptRoute(refused);
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
		ctx.setInputValue('here is the file');
		await ctx.uploadFile(textFile(), 'notes.txt');

		ctx.removeAttachment(0);

		expect(ctx.canSend).toBe(true);
	});

	it('retries with the same payload and succeeds', async () => {
		scriptRoute(refused, accepted);
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
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
		const held = Promise.withResolvers<Answer>();
		const opened = scriptRoute(refused, held.promise, accepted);
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
		await ctx.uploadFile(textFile(), 'notes.txt');

		ctx.retryUpload(0); // stalls
		await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
		ctx.retryUpload(0); // supersedes
		await vi.waitFor(() => expect(soleUploadState(ctx)?.status).toBe('success'));

		// Let the superseded attempt finish failing. Its outcome must be dropped,
		// not written over the success that already landed.
		held.resolve(refused);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(soleUploadState(ctx)?.status).toBe('success');
		expect(ctx.hasFailedUploads).toBe(false);
	});

	it('does not upload when the attachment is removed during preprocessing', async () => {
		// Preprocessing is awaited and cannot be canceled, so the composer may be
		// empty by the time it resolves. Uploading anyway would store a file
		// nothing references.
		const opened = scriptRoute();
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);

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
		expect(opened).not.toHaveBeenCalled();
	});

	it('takes attachments out of the composer when navigating between threads', () => {
		// Every surface reuses one context across threads and swaps only the text
		// draft, so an attachment left in place would be sent in the wrong thread —
		// and a failed one would block sending there.
		const core = createChatSession('thread-a');
		const ctx = new ChatUIContext(core, mockClient, new ChatComposer(), uploadConfig);
		ctx.setDisplayMessages([]);
		ctx.addAttachments([fileAttachment(undefined)]);

		core.setThread('thread-b');
		ctx.activate();

		expect(ctx.attachments).toHaveLength(0);
	});

	it('keeps attachments when a new thread gets its id', () => {
		// null -> id is this conversation being created, not a move to another
		// one: a file attached while creation was in flight belongs here.
		const core = createChatSession(null);
		const ctx = new ChatUIContext(core, mockClient, new ChatComposer(), uploadConfig);
		ctx.setDisplayMessages([]);
		ctx.addAttachments([fileAttachment(undefined)]);

		core.conversation.assign('thread-a');
		ctx.activate();

		expect(ctx.attachments).toHaveLength(1);
	});

	it('stays quiet when preprocessing fails after the attachment was removed', async () => {
		// Preprocessing cannot be canceled, so it can reject long after the chip
		// was discarded. Reporting that failure would be noise about a file the
		// user already dismissed.
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);

		let failPreprocess: (() => void) | undefined;
		const preprocessing = new Promise<void>((resolve) => {
			failPreprocess = resolve;
		});
		const upload = ctx.uploadFile(textFile(), 'notes.txt', {
			preprocess: async () => {
				await preprocessing;
				throw new Error('Image could not be compressed below 5 MB');
			}
		});

		await vi.waitFor(() => expect(ctx.attachments).toHaveLength(1));
		ctx.removeAttachment(0);
		failPreprocess?.();
		await upload;

		expect(ctx.attachments).toHaveLength(0);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('reports a preprocessing failure for an attachment still in the composer', async () => {
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);

		await ctx.uploadFile(textFile(), 'notes.txt', {
			preprocess: async () => {
				throw new Error('Image could not be compressed below 5 MB');
			}
		});

		expect(ctx.attachments).toHaveLength(0);
		expect(toast.error).toHaveBeenCalled();
	});

	it('does nothing when retrying an attachment with no retained payload', () => {
		const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
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
			// A route that never answers keeps the upload in flight for removal.
			scriptRoute(new Promise<Answer>(() => {}));
			const ctx = new ChatUIContext(mockCore, mockClient, new ChatComposer(), uploadConfig);
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
