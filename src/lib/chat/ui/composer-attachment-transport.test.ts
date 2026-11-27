/**
 * The two ways a composer moves bytes. The direct transport posts the bytes to
 * the surface's upload route. A surface's own transport gets the final payload,
 * returns an opaque result, and takes back through `release` what the composer
 * abandoned.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { toast } from 'svelte-sonner';
import { createChatSession } from '../__tests__/session-fixture';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { uploadBlobWithProgress, UploadError } from '../../uploads/transfer.js';
import type { UploadProfile } from '../../uploads/profiles.js';
import type { AttachmentUploadResult } from '../core/file-uploader.js';
import type { Attachment } from '../core/types.js';
import type { AttachmentTransferPayload } from './attachment-transfer.js';
import { ChatComposer } from './chat-composer.svelte.ts';
import { ChatUIContext } from './chat-context.svelte.ts';
import type { UploadConfig } from './composer-attachment-coordinator.svelte.ts';

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$app/env/public', () => ({ PUBLIC_CONVEX_SITE_URL: 'https://site.test' }));
vi.mock('../../auth-client.js', () => ({
	authClient: { convex: { token: async () => ({ data: { token: 'jwt-1' }, error: null }) } }
}));

type Attempt = {
	payload: AttachmentTransferPayload;
	onProgress: (progress: number) => void;
	signal: AbortSignal;
	succeed: (result: AttachmentUploadResult) => void;
	fail: (error: unknown) => void;
};

/** The surface's own transport, settled by the test. */
function surfaceTransport() {
	const attempts: Attempt[] = [];
	const upload = vi.fn(
		(
			payload: AttachmentTransferPayload,
			onProgress: (progress: number) => void,
			signal: AbortSignal
		) => {
			const { promise, resolve, reject } = Promise.withResolvers<AttachmentUploadResult>();
			attempts.push({ payload, onProgress, signal, succeed: resolve, fail: reject });
			return promise;
		}
	);
	const release = vi.fn<(result: AttachmentUploadResult) => Promise<void> | void>();
	return { attempts, upload, release };
}

const result = (id: string): AttachmentUploadResult => ({
	fileId: `upload-${id}`,
	url: `/attachments/upload-${id}`
});

const contexts: ChatUIContext[] = [];
/** A view on its own composer and session, showing `threadId`. */
function composerOn(
	config: UploadConfig,
	threadId: string | null = 'thread-a',
	activeUploads: { claim(owner: object): void; release(owner: object): void } | null = null,
	shared = new ChatComposer()
) {
	const session = createChatSession(threadId);
	const ctx = new ChatUIContext(
		session,
		{} as ConvexClient,
		shared,
		config,
		'right',
		activeUploads
	);
	contexts.push(ctx);
	return {
		ctx,
		/** Replace the shown conversation with a new one for `next`. */
		replaceWith(next: string | null) {
			session.setThread(next);
			ctx.activate();
		},
		/** Give the shown id-less conversation its thread id. */
		assign(next: string) {
			session.moveTo(next);
			ctx.activate();
		}
	};
}

const composer = (...args: Parameters<typeof composerOn>) => composerOn(...args).ctx;

/** Another view of `shared` on `threadId`. */
const viewOf = (
	shared: ChatComposer,
	config: UploadConfig,
	threadId = 'thread-a',
	activeUploads: { claim(owner: object): void; release(owner: object): void } | null = null
) => composerOn(config, threadId, activeUploads, shared).ctx;

function claims() {
	const owners = new Set<object>();
	return {
		owners,
		registry: {
			claim: (owner: object) => void owners.add(owner),
			release: (owner: object) => void owners.delete(owner)
		}
	};
}

/** A finished result with no transfer behind it, as `addAttachments` admits one. */
const keyless = (id: string): Attachment => ({
	type: 'file',
	name: `${id}.txt`,
	size: id.length,
	mimeType: 'text/plain',
	url: `/attachments/upload-${id}`,
	uploadState: { status: 'success', progress: 100, fileId: `upload-${id}` }
});

/** Send what `ctx` holds the way ChatInput does, and return the send's outcome callback. */
function sendFrom(ctx: ChatUIContext) {
	const snapshot = ctx.captureSendSnapshot();
	ctx.clearInputForSend(snapshot);
	const settle = ctx.beginSend(snapshot);
	ctx.clearAttachmentsForSend(snapshot);
	return settle;
}

const textFile = (name = 'notes.txt', body = 'notes') =>
	new File([body], name, { type: 'text/plain' });

function uploadState(attachment: Attachment | undefined) {
	return attachment && 'uploadState' in attachment ? attachment.uploadState : undefined;
}

/** A coordinator holding one adopted, unsent result. */
async function adopted(transport = surfaceTransport(), name = 'notes.txt') {
	const coordinator = composer({ upload: transport.upload, release: transport.release });
	const pending = coordinator.uploadFile(textFile(name));
	transport.attempts.at(-1)!.succeed(result(name));
	await pending;
	return { coordinator, transport };
}

beforeAll(() => {
	for (const name of ['createObjectURL', 'revokeObjectURL'] as const) {
		if (!(name in URL)) {
			Object.defineProperty(URL, name, { value: () => {}, writable: true, configurable: true });
		}
	}
});

beforeEach(() => {
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/attachment');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	for (const context of contexts.splice(0)) context.dispose();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function routeServer() {
	const handlers: Record<string, () => void> = {};
	const requests: Array<{ url: string; body: Blob }> = [];
	const open = vi.fn();
	vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
		let url = '';
		return {
			status: 200,
			responseText: JSON.stringify({
				fileId: 'file-1',
				url: 'https://cdn.test/file-1',
				isImage: false
			}),
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				handlers[event] = handler;
			},
			open: (_method: string, target: string) => {
				open();
				url = target;
			},
			setRequestHeader: () => {},
			abort: () => {},
			send: (body: Blob) => {
				requests.push({ url, body });
				handlers.load?.();
			}
		};
	});
	return { requests, open };
}

describe('the direct route transport', () => {
	it('posts the bytes to the surface route once, and removal sends nothing', async () => {
		const server = routeServer();
		const coordinator = composer({ purpose: 'support' });
		const file = textFile();

		await coordinator.uploadFile(file);

		expect(server.requests).toEqual([
			{ url: 'https://site.test/uploads/support?filename=notes.txt', body: file }
		]);
		expect(coordinator.attachments[0]).toMatchObject({
			url: 'https://cdn.test/file-1',
			uploadState: { status: 'success', fileId: 'file-1' }
		});

		coordinator.removeAttachment(0);
		coordinator.dispose();
		expect(server.open).toHaveBeenCalledOnce();
	});
});

describe('a custom attachment transport', () => {
	it('receives the final payload and its opaque result becomes the attachment reference', async () => {
		const transport = surfaceTransport();
		const coordinator = composer({
			upload: transport.upload,
			release: transport.release,
			getAccessKey: () => 'thread-a'
		});
		const file = textFile();

		const pending = coordinator.uploadFile(file);
		const [attempt] = transport.attempts;
		expect(attempt?.payload).toEqual({
			blob: file,
			filename: 'notes.txt',
			mimeType: 'text/plain',
			dimensions: undefined,
			accessKey: 'thread-a'
		});

		attempt!.onProgress(40);
		expect(uploadState(coordinator.attachments[0])).toEqual({ status: 'uploading', progress: 40 });

		attempt!.succeed(result('notes'));
		await pending;

		expect(coordinator.attachments[0]).toMatchObject({
			name: 'notes.txt',
			url: '/attachments/upload-notes',
			uploadState: { status: 'success', progress: 100, fileId: 'upload-notes' }
		});
		expect(coordinator.uploadedFileIds).toEqual(['upload-notes']);
		expect(transport.release).not.toHaveBeenCalled();
	});

	it.each([
		{ thrown: new UploadError('network'), shown: 'network' },
		{ thrown: new UploadError('http', 413), shown: 'http' },
		{ thrown: new Error('gateway said no'), shown: 'server' }
	])('shows a $shown failure for $thrown.message', async ({ thrown, shown }) => {
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, release: transport.release });

		const pending = coordinator.uploadFile(textFile());
		transport.attempts[0]!.fail(thrown);
		await pending;

		expect(uploadState(coordinator.attachments[0])).toEqual({
			status: 'error',
			progress: 0,
			error: shown
		});
		expect(coordinator.hasFailedUploads).toBe(true);
		expect(transport.release).not.toHaveBeenCalled();
	});

	it('keeps a dropped connection on the shared blob transport classified as network', async () => {
		const handlers: Record<string, () => void> = {};
		vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
			return {
				upload: { addEventListener: () => {} },
				addEventListener: (event: string, handler: () => void) => {
					handlers[event] = handler;
				},
				open: () => {},
				setRequestHeader: () => {},
				abort: () => {},
				send: () => handlers.error?.()
			};
		});
		const coordinator = composer({
			upload: (payload, onProgress, signal) =>
				uploadBlobWithProgress({
					url: 'https://gateway.test/uploads',
					blob: payload.blob,
					headers: { Authorization: 'Bearer attempt' },
					decode: () => result('never'),
					onProgress,
					signal
				})
		});

		await coordinator.uploadFile(textFile());

		expect(uploadState(coordinator.attachments[0])?.error).toBe('network');
	});

	it('cancels an attempt in flight on removal and has nothing to release', async () => {
		const transport = surfaceTransport();
		const owners = new Set<object>();
		const coordinator = composer(
			{ upload: transport.upload, release: transport.release },
			'thread-a',
			{ claim: (owner) => owners.add(owner), release: (owner) => owners.delete(owner) }
		);

		const pending = coordinator.uploadFile(textFile());
		const [attempt] = transport.attempts;
		expect(owners.size).toBe(1);

		coordinator.removeAttachment(0);
		expect(attempt!.signal.aborted).toBe(true);
		attempt!.fail(new DOMException('Upload canceled', 'AbortError'));
		await pending;

		expect(coordinator.attachments).toEqual([]);
		expect(owners.size).toBe(0);
		expect(transport.release).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'removed',
			abandon: (coordinator: ChatUIContext) => coordinator.removeAttachment(0)
		},
		{
			name: 'disposed',
			abandon: (coordinator: ChatUIContext) => coordinator.dispose()
		}
	])(
		'releases a success that lands after its attachment was $name, exactly once',
		async ({ abandon }) => {
			const transport = surfaceTransport();
			const owners = new Set<object>();
			const coordinator = composer(
				{ upload: transport.upload, release: transport.release },
				'thread-a',
				{ claim: (owner) => owners.add(owner), release: (owner) => owners.delete(owner) }
			);

			const pending = coordinator.uploadFile(textFile());
			abandon(coordinator);
			// The transport could not stop in time and committed anyway.
			transport.attempts[0]!.succeed(result('late'));
			await pending;
			coordinator.clearAttachments();
			coordinator.dispose();

			expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('late'));
			expect(coordinator.attachments).toEqual([]);
			expect(coordinator.uploadedFileIds).toEqual([]);
			expect(owners.size).toBe(0);
		}
	);

	it('releases an adopted, unsent result once when its attachment is removed', async () => {
		const { coordinator, transport } = await adopted();

		coordinator.removeAttachment(0);
		coordinator.clearAttachments();
		coordinator.dispose();

		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('notes.txt'));
	});

	it('releases the copy a parked attachment replaces when its thread returns', async () => {
		const transport = surfaceTransport();
		const chat = composerOn({ upload: transport.upload, release: transport.release });
		const coordinator = chat.ctx;
		const first = coordinator.uploadFile(textFile());
		transport.attempts[0]!.succeed(result('first'));
		await first;

		chat.replaceWith(null);
		const second = coordinator.uploadFile(textFile());
		transport.attempts[1]!.succeed(result('second'));
		await second;
		expect(transport.release).not.toHaveBeenCalled();

		chat.assign('thread-a');

		expect(coordinator.uploadedFileIds).toEqual(['upload-first']);
		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('second'));
	});

	it('releases every live and parked unsent result when the composer is disposed', async () => {
		const transport = surfaceTransport();
		const chat = composerOn({ upload: transport.upload, release: transport.release });
		const coordinator = chat.ctx;
		const parked = coordinator.uploadFile(textFile('parked.txt'));
		transport.attempts[0]!.succeed(result('parked'));
		await parked;
		chat.replaceWith('thread-b');
		const live = coordinator.uploadFile(textFile('live.txt'));
		transport.attempts[1]!.succeed(result('live'));
		await live;

		coordinator.dispose();

		expect(transport.release).toHaveBeenCalledTimes(2);
		expect(transport.release).toHaveBeenCalledWith(result('parked'));
		expect(transport.release).toHaveBeenCalledWith(result('live'));
	});

	it('never releases what a send cleared, and releases it once a refused send restored it', async () => {
		const { coordinator, transport } = await adopted();

		const settle = sendFrom(coordinator);
		expect(coordinator.attachments).toEqual([]);
		expect(transport.release).not.toHaveBeenCalled();

		settle('refused');
		expect(coordinator.uploadedFileIds).toEqual(['upload-notes.txt']);
		coordinator.removeAttachment(0);
		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('notes.txt'));
	});

	it('releases a result once even when an older send snapshot brings it back', async () => {
		const { coordinator, transport } = await adopted();
		const settle = coordinator.beginSend(coordinator.captureSendSnapshot());

		coordinator.removeAttachment(0);
		settle('refused');
		expect(coordinator.uploadedFileIds).toEqual(['upload-notes.txt']);
		coordinator.removeAttachment(0);

		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('notes.txt'));
	});

	it('does not release a sent result when the composer is disposed afterwards', async () => {
		const { coordinator, transport } = await adopted();

		const settle = sendFrom(coordinator);
		coordinator.dispose();
		settle('accepted');

		expect(transport.release).not.toHaveBeenCalled();
	});

	it.each([
		{ name: 'rejects', fail: () => Promise.reject(new Error('gateway unreachable')) },
		{
			name: 'throws',
			fail: () => {
				throw new Error('gateway unreachable');
			}
		}
	])('reports a release that $name instead of leaving it unhandled', async ({ fail }) => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			const transport = surfaceTransport();
			transport.release.mockImplementation(fail);
			const { coordinator } = await adopted(transport);

			expect(() => coordinator.removeAttachment(0)).not.toThrow();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(transport.release).toHaveBeenCalledOnce();
			expect(unhandled).not.toHaveBeenCalled();
			expect(console.error).toHaveBeenCalledExactlyOnceWith(
				'[ComposerAttachmentCoordinator] Release failed'
			);
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it('admits only as many attachments as the surface profile allows', async () => {
		const profile: UploadProfile = {
			extensions: { '.txt': 'text/plain' },
			maxBytes: 100,
			maxBytesLabel: '100 B',
			maxFiles: 2
		};
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, profile });

		void coordinator.uploadFile(textFile('one.txt'));
		void coordinator.uploadFile(textFile('two.txt'));
		void coordinator.uploadFile(textFile('three.txt'));

		expect(coordinator.maxAttachments).toBe(2);
		expect(coordinator.canAddAttachment).toBe(false);
		expect(transport.upload).toHaveBeenCalledTimes(2);
		expect(
			coordinator.attachments.map((attachment) => 'name' in attachment && attachment.name)
		).toEqual(['one.txt', 'two.txt']);
	});
});

describe('results across the views of one composer', () => {
	it('releases a late refusal through the transport it was sent with, after two session ends', async () => {
		const sentWith = surfaceTransport();
		const mountedNow = surfaceTransport();
		const shared = new ChatComposer();
		const first = viewOf(shared, { upload: sentWith.upload, release: sentWith.release });
		const pending = first.uploadFile(textFile());
		sentWith.attempts[0]!.succeed(result('notes'));
		await pending;
		const settle = sendFrom(first);
		first.dispose();
		const second = viewOf(shared, { upload: mountedNow.upload, release: mountedNow.release });

		clearPersistedChatState();
		clearPersistedChatState();
		settle('refused');
		settle('refused');

		expect(sentWith.release).toHaveBeenCalledExactlyOnceWith(result('notes'));
		expect(mountedNow.release).not.toHaveBeenCalled();
		expect(second.attachments).toEqual([]);
	});

	it('uploads with the settings of the view that starts it, and hands a gone view its late result', async () => {
		vi.mocked(toast.error).mockClear();
		const before = surfaceTransport();
		const after = surfaceTransport();
		const beforeClaims = claims();
		const afterClaims = claims();
		const roomy: UploadProfile = {
			extensions: { '.txt': 'text/plain' },
			maxBytes: 100,
			maxBytesLabel: '100 B',
			maxFiles: 6
		};
		const shared = new ChatComposer();
		const first = viewOf(
			shared,
			{
				upload: before.upload,
				release: before.release,
				profile: roomy,
				translate: (key) => `before:${key}`
			},
			'thread-a',
			beforeClaims.registry
		);
		const invalidated = first.uploadFile(textFile());
		expect(beforeClaims.owners.size).toBe(1);

		first.dispose();
		expect(before.attempts[0]!.signal.aborted).toBe(true);
		expect(beforeClaims.owners.size).toBe(0);
		const second = viewOf(
			shared,
			{
				upload: after.upload,
				release: after.release,
				profile: { ...roomy, maxBytes: 10, maxBytesLabel: '10 B' },
				translate: (key) => `after:${key}`
			},
			'thread-a',
			afterClaims.registry
		);
		before.attempts[0]!.succeed(result('late'));
		await invalidated;
		expect(before.release).toHaveBeenCalledExactlyOnceWith(result('late'));

		await second.uploadFile(textFile('large.txt', 'x'.repeat(50)));
		expect(toast.error).toHaveBeenCalledExactlyOnceWith('after:chat.error.file_too_large', {
			description: 'after:chat.error.file_max_size'
		});
		const fresh = second.uploadFile(textFile('small.txt', 'ok'));
		expect(after.upload).toHaveBeenCalledOnce();
		expect(before.upload).toHaveBeenCalledOnce();
		expect(afterClaims.owners.size).toBe(1);
		after.attempts[0]!.succeed(result('small'));
		await fresh;

		expect(second.uploadedFileIds).toEqual(['upload-small']);
		expect(afterClaims.owners.size).toBe(0);
		expect(before.release).toHaveBeenCalledOnce();
		expect(after.release).not.toHaveBeenCalled();
	});

	it('releases results with one file id through the transport each came from', async () => {
		const a = surfaceTransport();
		const b = surfaceTransport();
		const shared = new ChatComposer();
		const first = viewOf(shared, { upload: a.upload, release: a.release });
		const fromA = first.uploadFile(textFile('a.txt'));
		a.attempts[0]!.succeed(result('same'));
		await fromA;
		const second = viewOf(shared, { upload: b.upload, release: b.release });
		const fromB = second.uploadFile(textFile('b.txt'));
		b.attempts[0]!.succeed(result('same'));
		await fromB;
		expect(second.attachments).toHaveLength(2);

		second.removeAttachment(1);
		expect(b.release).toHaveBeenCalledExactlyOnceWith(result('same'));
		expect(a.release).not.toHaveBeenCalled();

		first.dispose();
		second.dispose();
		expect(a.release).toHaveBeenCalledExactlyOnceWith(result('same'));
		expect(b.release).toHaveBeenCalledOnce();
	});

	it('releases a keyless result once, also after a refused send brought it back', () => {
		const transport = surfaceTransport();
		const ctx = composer({ upload: transport.upload, release: transport.release });
		ctx.addAttachments([keyless('first')]);
		const settle = ctx.beginSend(ctx.captureSendSnapshot());

		ctx.removeAttachment(0);
		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('first'));
		settle('refused');
		expect(ctx.uploadedFileIds).toEqual(['upload-first']);
		ctx.removeAttachment(0);
		expect(transport.release).toHaveBeenCalledOnce();

		ctx.addAttachments([keyless('second')]);
		ctx.removeAttachment(0);
		expect(transport.release).toHaveBeenCalledTimes(2);
		expect(transport.release).toHaveBeenLastCalledWith(result('second'));
	});

	it('releases a keyless result through the view that added it, after that view closed', () => {
		const adding = surfaceTransport();
		const remaining = surfaceTransport();
		const shared = new ChatComposer();
		const first = viewOf(shared, { upload: adding.upload, release: adding.release });
		const second = viewOf(shared, { upload: remaining.upload, release: remaining.release });
		first.addAttachments([keyless('kept')]);
		const settle = sendFrom(first);
		first.dispose();

		settle('refused');
		expect(second.uploadedFileIds).toEqual(['upload-kept']);
		const older = second.beginSend(second.captureSendSnapshot());
		second.removeAttachment(0);
		expect(adding.release).toHaveBeenCalledExactlyOnceWith(result('kept'));

		older('refused');
		expect(second.uploadedFileIds).toEqual(['upload-kept']);
		second.removeAttachment(0);
		second.dispose();
		expect(adding.release).toHaveBeenCalledOnce();
		expect(remaining.release).not.toHaveBeenCalled();
	});

	it('keeps the off-screen transfer of a mounted view when another view closes', async () => {
		const transport = surfaceTransport();
		const config = { upload: transport.upload, release: transport.release };
		const uploads = claims();
		const shared = new ChatComposer();
		const first = composerOn(config, 'thread-1', uploads.registry, shared);
		const second = viewOf(shared, config, 'thread-3', uploads.registry);
		const pending = first.ctx.uploadFile(textFile());
		first.replaceWith('thread-2');

		second.dispose();
		expect(transport.attempts[0]!.signal.aborted).toBe(false);
		expect(uploads.owners.size).toBe(1);

		first.replaceWith('thread-1');
		expect(uploadState(first.ctx.attachments[0])?.status).toBe('uploading');
		transport.attempts[0]!.succeed(result('notes'));
		await pending;
		expect(first.ctx.uploadedFileIds).toEqual(['upload-notes']);
		expect(uploads.owners.size).toBe(0);
	});

	it('cancels the off-screen transfer of a view once that view closes', () => {
		const transport = surfaceTransport();
		const uploads = claims();
		const first = composerOn(
			{ upload: transport.upload, release: transport.release },
			'thread-1',
			uploads.registry
		);
		void first.ctx.uploadFile(textFile());
		first.replaceWith('thread-2');

		first.ctx.dispose();

		expect(transport.attempts[0]!.signal.aborted).toBe(true);
		expect(uploads.owners.size).toBe(0);
	});

	it('keeps the files of a thread while another view still shows it', async () => {
		const transport = surfaceTransport();
		const config = { upload: transport.upload, release: transport.release };
		const shared = new ChatComposer();
		const first = viewOf(shared, config);
		const second = viewOf(shared, config);
		const done = first.uploadFile(textFile('done.txt'));
		transport.attempts[0]!.succeed(result('done'));
		await done;
		const running = first.uploadFile(textFile('running.txt'));

		first.dispose();
		expect(transport.attempts[1]!.signal.aborted).toBe(false);
		transport.attempts[1]!.succeed(result('running'));
		await running;

		expect(second.uploadedFileIds).toEqual(['upload-done', 'upload-running']);
		expect(transport.release).not.toHaveBeenCalled();
		second.dispose();
		expect(transport.release).toHaveBeenCalledTimes(2);
	});
});

describe('the final payload check', () => {
	/** Storage takes 100 bytes, but whatever reads images takes only 40. */
	const profile: UploadProfile = {
		extensions: { '.txt': 'text/plain', '.png': 'image/png' },
		maxBytes: 100,
		maxBytesLabel: '100 B',
		maxFiles: 6,
		maxImageBytes: 40,
		maxImageBytesLabel: '40 B'
	};
	const sized = (size: number, name: string, type: string) =>
		new File(['x'.repeat(size)], name, { type });
	const screenshot = (size: number, type = 'image/png') => new Blob(['x'.repeat(size)], { type });
	const tooLarge = (filename: string, maxSize: string) => [
		`File too large: "${filename}"`,
		{ description: `Maximum size is ${maxSize}` }
	];
	const notAllowed = (filename: string) => [`File type not allowed: "${filename}"`];

	beforeEach(() => {
		vi.mocked(toast.error).mockClear();
		// jsdom never loads images, so measuring a picked image would never finish.
		vi.stubGlobal(
			'Image',
			class {
				naturalWidth = 4;
				naturalHeight = 4;
				onload: (() => void) | null = null;
				set src(_url: string) {
					queueMicrotask(() => this.onload?.());
				}
			}
		);
	});

	it.each([
		{ name: 'a file at maxBytes', file: sized(100, 'notes.txt', 'text/plain') },
		{ name: 'an image at the image limit', file: sized(40, 'photo.png', 'image/png') },
		{ name: 'a generic type its extension maps', file: sized(5, 'notes.txt', '') }
	])('uploads $name', async ({ file }) => {
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, profile });

		const pending = coordinator.uploadFile(file);
		await vi.waitFor(() => expect(transport.upload).toHaveBeenCalledOnce());
		transport.attempts[0]!.succeed(result('allowed'));
		await pending;

		expect(transport.attempts[0]!.payload.blob).toBe(file);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'a file one byte over maxBytes',
			file: sized(101, 'notes.txt', 'text/plain'),
			shown: tooLarge('notes.txt', '100 B')
		},
		{
			name: 'an image one byte over the image limit',
			file: sized(41, 'photo.png', 'image/png'),
			shown: tooLarge('photo.png', '40 B')
		},
		{
			name: 'a type the profile does not accept',
			file: sized(5, 'report.pdf', 'application/pdf'),
			shown: notAllowed('report.pdf')
		},
		{
			name: 'a generic type whose extension maps to nothing',
			file: sized(5, 'notes.bin', ''),
			shown: notAllowed('notes.bin')
		}
	])('never uploads $name and says why', async ({ file, shown }) => {
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, profile });

		await coordinator.uploadFile(file);

		expect(transport.upload).not.toHaveBeenCalled();
		expect(coordinator.attachments).toEqual([]);
		expect(toast.error).toHaveBeenCalledExactlyOnceWith(...shown);
	});

	it.each([
		{ size: 40, uploads: true },
		{ size: 41, uploads: false }
	])('holds a $size byte screenshot to the image limit', async ({ size, uploads }) => {
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, profile });
		const blob = screenshot(size);

		const pending = coordinator.uploadScreenshot(blob, 'screenshot.png', { width: 4, height: 4 });
		if (uploads) {
			expect(transport.attempts[0]?.payload.blob).toBe(blob);
			transport.attempts[0]!.succeed(result('screenshot'));
		}
		await pending;

		if (uploads) {
			expect(coordinator.uploadedFileIds).toEqual(['upload-screenshot']);
			expect(toast.error).not.toHaveBeenCalled();
		} else {
			expect(transport.upload).not.toHaveBeenCalled();
			expect(coordinator.attachments).toEqual([]);
			expect(toast.error).toHaveBeenCalledExactlyOnceWith(...tooLarge('screenshot.png', '40 B'));
		}
	});

	it('never uploads a screenshot of a type the profile does not accept', async () => {
		const transport = surfaceTransport();
		const coordinator = composer({ upload: transport.upload, profile });

		await coordinator.uploadScreenshot(screenshot(5, 'image/webp'), 'screenshot.webp');

		expect(transport.upload).not.toHaveBeenCalled();
		expect(coordinator.attachments).toEqual([]);
		expect(toast.error).toHaveBeenCalledExactlyOnceWith(...notAllowed('screenshot.webp'));
	});

	it('never posts a refused payload to the upload route', async () => {
		const server = routeServer();
		const coordinator = composer({ purpose: 'support', profile });

		await coordinator.uploadFile(sized(101, 'notes.txt', 'text/plain'));
		await coordinator.uploadScreenshot(screenshot(41), 'screenshot.png', { width: 4, height: 4 });

		expect(server.open).not.toHaveBeenCalled();
		expect(coordinator.attachments).toEqual([]);
		expect(toast.error).toHaveBeenCalledTimes(2);
	});
});
