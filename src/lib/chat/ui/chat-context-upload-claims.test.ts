/**
 * The context, not the component, reports a transfer in progress.
 *
 * Closing the support panel unmounts the chat while its context and the bytes
 * on the wire survive, so a claim scoped to the component would be given up
 * mid-transfer and the page would stop asking before a reload. These tests pin
 * the claim to the context's own view of what is still running.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { ChatCore } from '../core/chat-core.svelte.ts';

const uploadFileWithProgress = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', () => ({
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args),
	UploadError: class UploadError extends Error {}
}));

const { ChatUIContext } = await import('./chat-context.svelte.ts');
const { ActiveUploads } = await import('$lib/hooks/active-uploads.svelte.ts');

const uploadConfig = {
	generateUploadUrl: 'storage:generateUploadUrl',
	saveUploadedFile: 'storage:saveUploadedFile'
} as unknown as ConstructorParameters<typeof ChatUIContext>[2];

function context(uploads: InstanceType<typeof ActiveUploads> | null = null) {
	return new ChatUIContext({} as ChatCore, {} as ConvexClient, uploadConfig, 'right', uploads);
}

/** A transfer the test decides the outcome of. */
function pendingTransfer() {
	let settle!: (result: { url: string; fileId: string }) => void;
	let fail!: (error: unknown) => void;
	uploadFileWithProgress.mockImplementationOnce(
		() =>
			new Promise((resolve, reject) => {
				settle = resolve;
				fail = reject;
			})
	);
	return {
		succeed: () => settle({ url: 'https://example.test/f', fileId: 'file-1' }),
		reject: (error: unknown) => fail(error)
	};
}

const shot = () => new Blob(['x'], { type: 'image/png' });

describe('ChatUIContext upload claims', () => {
	beforeEach(() => {
		uploadFileWithProgress.mockReset();
	});

	it('claims while a transfer runs and lets go once it lands', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const transfer = pendingTransfer();
		const upload = ctx.uploadScreenshot(shot(), 'shot.png');
		expect(uploads.any).toBe(true);

		transfer.succeed();
		await upload;
		expect(uploads.any).toBe(false);
	});

	it('lets go when the transfer fails, not only when it succeeds', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const transfer = pendingTransfer();
		const upload = ctx.uploadScreenshot(shot(), 'shot.png');
		transfer.reject(new Error('network'));
		await upload;

		// A failed upload is recoverable, but it is not on the wire any more, so
		// leaving the page costs nothing.
		expect(uploads.any).toBe(false);
	});

	it('keeps the claim while a second transfer is still running', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const first = pendingTransfer();
		const second = pendingTransfer();
		const firstUpload = ctx.uploadScreenshot(shot(), 'one.png');
		const secondUpload = ctx.uploadScreenshot(shot(), 'two.png');

		first.succeed();
		await firstUpload;
		expect(uploads.any).toBe(true);

		second.succeed();
		await secondUpload;
		expect(uploads.any).toBe(false);
	});

	it('lets go when the context is disposed mid-transfer', async () => {
		// The surface is gone for good here, unlike an unmounted chat whose
		// context lives on; nothing is left that could report the outcome.
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		pendingTransfer();
		void ctx.uploadScreenshot(shot(), 'shot.png');
		expect(uploads.any).toBe(true);

		ctx.dispose();
		expect(uploads.any).toBe(false);
	});

	it('works without a registry, for a chat rendered outside the app shell', async () => {
		const ctx = context();
		const transfer = pendingTransfer();

		const upload = ctx.uploadScreenshot(shot(), 'shot.png');
		transfer.succeed();
		await expect(upload).resolves.toBeUndefined();
	});
});

describe('ChatUIContext upload claims, removal paths', () => {
	beforeEach(() => {
		uploadFileWithProgress.mockReset();
	});

	it('lets go after the only uploading attachment is removed', async () => {
		// removeAttachment drops the aborter synchronously; the claim can only be
		// given up once the aborted attempt actually unwinds.
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const transfer = pendingTransfer();
		const upload = ctx.uploadScreenshot(shot(), 'shot.png');
		expect(uploads.any).toBe(true);

		ctx.removeAttachment(0);
		transfer.reject(new DOMException('aborted', 'AbortError'));
		await upload;

		expect(uploads.any).toBe(false);
	});

	it('holds on when one of two attachments is removed', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const first = pendingTransfer();
		const second = pendingTransfer();
		const firstUpload = ctx.uploadScreenshot(shot(), 'one.png');
		const secondUpload = ctx.uploadScreenshot(shot(), 'two.png');

		ctx.removeAttachment(0);
		first.reject(new DOMException('aborted', 'AbortError'));
		await firstUpload;
		expect(uploads.any).toBe(true);

		second.succeed();
		await secondUpload;
		expect(uploads.any).toBe(false);
	});

	it('a superseded attempt does not let go while its replacement runs', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const first = pendingTransfer();
		const upload = ctx.uploadScreenshot(shot(), 'shot.png');
		first.reject(new Error('network'));
		await upload;

		const retry = pendingTransfer();
		ctx.retryUpload(0);
		expect(uploads.any).toBe(true);

		retry.succeed();
		await Promise.resolve();
		await Promise.resolve();
		expect(uploads.any).toBe(false);
	});
});

describe('ChatUIContext upload claims, before the bytes move', () => {
	beforeEach(() => {
		uploadFileWithProgress.mockReset();
	});

	it('claims while an image is still being converted', async () => {
		// The tile shows progress from the moment the file is picked, and the
		// encoder can run for seconds on a large photo. Losing the page there
		// loses the pick, transfer started or not.
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		let finishEncoding!: () => void;
		const encoded = new Promise<void>((resolve) => {
			finishEncoding = resolve;
		});
		const transfer = pendingTransfer();

		const upload = ctx.uploadFile(new Blob(['x'], { type: 'image/png' }), 'photo.png', {
			preprocess: async (input) => {
				await encoded;
				// Dimensions supplied, so the transfer is the next thing to happen.
				return {
					blob: input,
					mimeType: 'image/webp',
					filename: 'photo.webp',
					width: 10,
					height: 10
				};
			}
		});

		// Nothing has been sent yet, and the guard already has to hold.
		expect(uploads.any).toBe(true);
		expect(uploadFileWithProgress).not.toHaveBeenCalled();

		finishEncoding();
		while (uploadFileWithProgress.mock.calls.length === 0) await Promise.resolve();

		expect(uploads.any).toBe(true);
		transfer.succeed();
		await upload;
		expect(uploads.any).toBe(false);
	});

	it('lets go when conversion fails before any transfer', async () => {
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		const upload = ctx.uploadFile(new Blob(['x'], { type: 'image/png' }), 'photo.png', {
			preprocess: async () => {
				throw new Error('too large to compress');
			}
		});

		expect(uploads.any).toBe(true);
		await upload;
		expect(uploads.any).toBe(false);
	});

	it('lets go the moment a discarded attachment is removed, not when its request unwinds', async () => {
		// Aborting cannot stop a Convex mutation that is already out, so waiting
		// for the attempt to unwind would keep asking about a discarded file for
		// as long as that request hangs.
		const uploads = new ActiveUploads();
		const ctx = context(uploads);

		pendingTransfer();
		void ctx.uploadScreenshot(shot(), 'shot.png');
		expect(uploads.any).toBe(true);

		ctx.removeAttachment(0);
		expect(uploads.any).toBe(false);
	});
});
