/**
 * The two ways a composer moves bytes. The direct transport grants, uploads
 * and commits through Convex storage. A surface's own transport gets the final
 * payload, returns an opaque result, and takes back through `release` what the
 * composer abandoned.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { uploadBlobWithProgress, UploadError } from '../../uploads/transfer.js';
import type { UploadProfile } from '../../uploads/profiles.js';
import type { AttachmentUploadResult } from '../core/file-uploader.js';
import type { Attachment } from '../core/types.js';
import type { AttachmentTransferPayload } from './attachment-transfer.js';
import {
	ComposerAttachmentCoordinator,
	type UploadConfig
} from './composer-attachment-coordinator.svelte.ts';

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

const coordinators: ComposerAttachmentCoordinator[] = [];
function composer(
	config: UploadConfig,
	thread: { current: string | null } = { current: 'thread-a' },
	activeUploads?: { claim(owner: object): void; release(owner: object): void },
	// Any Convex call would throw: a custom transport must not reach storage.
	client = {} as ConvexClient
) {
	const coordinator = new ComposerAttachmentCoordinator({
		getThreadId: () => thread.current,
		client,
		uploadConfig: config,
		activeUploads
	});
	coordinator.syncThread();
	coordinators.push(coordinator);
	return coordinator;
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
	for (const coordinator of coordinators.splice(0)) coordinator.dispose();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('the direct storage transport', () => {
	it('grants, uploads and commits through Convex, and removal deletes nothing', async () => {
		const handlers: Record<string, () => void> = {};
		const sent: Blob[] = [];
		vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
			return {
				status: 200,
				responseText: JSON.stringify({ storageId: 'storage-1' }),
				upload: { addEventListener: () => {} },
				addEventListener: (event: string, handler: () => void) => {
					handlers[event] = handler;
				},
				open: () => {},
				setRequestHeader: () => {},
				abort: () => {},
				send: (body: Blob) => {
					sent.push(body);
					handlers.load?.();
				}
			};
		});
		const client = {
			mutation: vi.fn(async () => ({ uploadUrl: 'https://storage.test', uploadToken: 'token-1' })),
			action: vi.fn(async () => ({ fileId: 'file-1', url: 'https://cdn.test/file-1' }))
		};
		const coordinator = composer(
			{
				generateUploadUrl: api.support.files.generateUploadUrl,
				saveUploadedFile: api.support.files.saveUploadedFile
			},
			{ current: 'thread-a' },
			undefined,
			client as unknown as ConvexClient
		);
		const file = textFile();

		await coordinator.uploadFile(file);

		expect(sent).toEqual([file]);
		expect(client.action).toHaveBeenCalledExactlyOnceWith(
			api.support.files.saveUploadedFile,
			expect.objectContaining({
				storageId: 'storage-1',
				uploadToken: 'token-1',
				filename: 'notes.txt',
				mimeType: 'text/plain'
			})
		);
		expect(coordinator.attachments[0]).toMatchObject({
			url: 'https://cdn.test/file-1',
			uploadState: { status: 'success', fileId: 'file-1' }
		});

		coordinator.removeAttachment(0);
		coordinator.dispose();
		expect(client.mutation).toHaveBeenCalledOnce();
		expect(client.action).toHaveBeenCalledOnce();
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
			{ current: 'thread-a' },
			{ claim: (owner) => owners.add(owner), release: (owner) => owners.delete(owner) }
		);

		const pending = coordinator.uploadFile(textFile());
		const [attempt] = transport.attempts;
		expect(owners.has(coordinator)).toBe(true);

		coordinator.removeAttachment(0);
		expect(attempt!.signal.aborted).toBe(true);
		attempt!.fail(new DOMException('Upload canceled', 'AbortError'));
		await pending;

		expect(coordinator.attachments).toEqual([]);
		expect(owners.has(coordinator)).toBe(false);
		expect(transport.release).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'removed',
			abandon: (coordinator: ComposerAttachmentCoordinator) => coordinator.removeAttachment(0)
		},
		{
			name: 'disposed',
			abandon: (coordinator: ComposerAttachmentCoordinator) => coordinator.dispose()
		}
	])(
		'releases a success that lands after its attachment was $name, exactly once',
		async ({ abandon }) => {
			const transport = surfaceTransport();
			const owners = new Set<object>();
			const coordinator = composer(
				{ upload: transport.upload, release: transport.release },
				{ current: 'thread-a' },
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
			expect(owners.has(coordinator)).toBe(false);
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
		const thread = { current: 'thread-a' as string | null };
		const coordinator = composer({ upload: transport.upload, release: transport.release }, thread);
		const first = coordinator.uploadFile(textFile());
		transport.attempts[0]!.succeed(result('first'));
		await first;

		thread.current = null;
		coordinator.syncThread();
		const second = coordinator.uploadFile(textFile());
		transport.attempts[1]!.succeed(result('second'));
		await second;
		expect(transport.release).not.toHaveBeenCalled();

		thread.current = 'thread-a';
		coordinator.syncThread();

		expect(coordinator.uploadedFileIds).toEqual(['upload-first']);
		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('second'));
	});

	it('releases every live and parked unsent result when the composer is disposed', async () => {
		const transport = surfaceTransport();
		const thread = { current: 'thread-a' as string | null };
		const coordinator = composer({ upload: transport.upload, release: transport.release }, thread);
		const parked = coordinator.uploadFile(textFile('parked.txt'));
		transport.attempts[0]!.succeed(result('parked'));
		await parked;
		thread.current = 'thread-b';
		coordinator.syncThread();
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

		const snapshot = coordinator.captureSendAttachments();
		coordinator.clearSendAttachments(snapshot);
		expect(coordinator.attachments).toEqual([]);
		expect(transport.release).not.toHaveBeenCalled();

		coordinator.restoreSendAttachments(snapshot);
		expect(coordinator.uploadedFileIds).toEqual(['upload-notes.txt']);
		coordinator.removeAttachment(0);
		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('notes.txt'));
	});

	it('releases a result once even when an older send snapshot brings it back', async () => {
		const { coordinator, transport } = await adopted();
		const snapshot = coordinator.captureSendAttachments();

		coordinator.removeAttachment(0);
		coordinator.restoreSendAttachments(snapshot);
		coordinator.removeAttachment(0);

		expect(transport.release).toHaveBeenCalledExactlyOnceWith(result('notes.txt'));
	});

	it('does not release a sent result when the composer is disposed afterwards', async () => {
		const { coordinator, transport } = await adopted();

		coordinator.clearSendAttachments(coordinator.captureSendAttachments());
		coordinator.dispose();

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

	it('never asks direct storage for a grant for a refused payload', async () => {
		const client = { mutation: vi.fn(), action: vi.fn() };
		const coordinator = composer(
			{
				generateUploadUrl: api.support.files.generateUploadUrl,
				saveUploadedFile: api.support.files.saveUploadedFile,
				profile
			},
			undefined,
			undefined,
			client as unknown as ConvexClient
		);

		await coordinator.uploadFile(sized(101, 'notes.txt', 'text/plain'));
		await coordinator.uploadScreenshot(screenshot(41), 'screenshot.png', { width: 4, height: 4 });

		expect(client.mutation).not.toHaveBeenCalled();
		expect(client.action).not.toHaveBeenCalled();
		expect(coordinator.attachments).toEqual([]);
		expect(toast.error).toHaveBeenCalledTimes(2);
	});
});
