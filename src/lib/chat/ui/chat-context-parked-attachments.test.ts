/**
 * An attachment survives the switch to another thread.
 *
 * Picking a different thread mid-transfer used to cancel the upload and remove
 * the attachment without a word, so a file the user was still waiting on looked
 * sent. The composer is still emptied, because attachments belong to the thread
 * they were picked in, but the transfer keeps running and the tile is back where
 * it belongs on the way back.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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

/** A transfer the test decides the outcome of, plus the signal that cancels it. */
function pendingTransfer() {
	let settle!: (result: { url: string; fileId: string }) => void;
	let fail!: (error: unknown) => void;
	let signal: AbortSignal | undefined;
	let report: ((progress: number) => void) | undefined;
	uploadFileWithProgress.mockImplementationOnce(
		(...args: unknown[]) =>
			new Promise((resolve, reject) => {
				report = args[3] as (progress: number) => void;
				signal = args[7] as AbortSignal;
				settle = resolve;
				fail = reject;
			})
	);
	return {
		succeed: (fileId = 'file-1') => settle({ url: `https://example.test/${fileId}`, fileId }),
		reject: (error: unknown) => fail(error),
		progress: (percent: number) => report?.(percent),
		get canceled() {
			return signal?.aborted ?? false;
		}
	};
}

/** A chat sitting in one thread, able to move to another. */
function threadedChat(threadId: string, uploads: InstanceType<typeof ActiveUploads> | null = null) {
	const core = { threadId } as unknown as ChatCore;
	const ctx = new ChatUIContext(core, {} as ConvexClient, uploadConfig, 'right', uploads);
	// The first call is what gives the context a thread to compare against.
	ctx.setDisplayMessages([]);
	return {
		ctx,
		switchTo(next: string | null) {
			(core as { threadId: string | null }).threadId = next;
			ctx.setDisplayMessages([]);
		}
	};
}

const shot = () => new Blob(['x'], { type: 'image/png' });

function uploadState(ctx: InstanceType<typeof ChatUIContext>, index = 0) {
	const attachment = ctx.attachments[index];
	return attachment && 'uploadState' in attachment ? attachment.uploadState : undefined;
}

/** Only picked files carry a name; plain image attachments have none. */
function names(ctx: InstanceType<typeof ChatUIContext>) {
	return ctx.attachments.map((a) => ('name' in a ? a.name : undefined));
}

describe('ChatUIContext parked attachments', () => {
	beforeAll(() => {
		// jsdom does not implement revokeObjectURL
		if (!('revokeObjectURL' in URL)) {
			Object.defineProperty(URL, 'revokeObjectURL', {
				value: () => {},
				writable: true,
				configurable: true
			});
		}
	});

	beforeEach(() => {
		uploadFileWithProgress.mockReset();
	});

	it('brings the attachment back when the user returns to its thread', () => {
		const transfer = pendingTransfer();
		const chat = threadedChat('thread-a');
		void chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo('thread-b');
		expect(chat.ctx.attachments).toHaveLength(0);
		expect(transfer.canceled).toBe(false);

		chat.switchTo('thread-a');
		expect(chat.ctx.attachments).toHaveLength(1);
		expect(transfer.canceled).toBe(false);
	});

	it('shows a thread its own attachments, not the ones left behind', () => {
		pendingTransfer();
		const chat = threadedChat('thread-a');
		void chat.ctx.uploadScreenshot(shot(), 'from-a.png');

		pendingTransfer();
		chat.switchTo('thread-b');
		void chat.ctx.uploadScreenshot(shot(), 'from-b.png');
		expect(names(chat.ctx)).toEqual(['from-b.png']);

		chat.switchTo('thread-a');
		expect(names(chat.ctx)).toEqual(['from-a.png']);
	});

	it('records the result of a transfer that lands while its thread is parked', async () => {
		// The write has to find the attachment where it actually is. Through the
		// composer alone it would go nowhere, and the user would come back to a
		// tile loading forever for a file that is already stored.
		const transfer = pendingTransfer();
		const chat = threadedChat('thread-a');
		const upload = chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo('thread-b');
		transfer.succeed('file-parked');
		await upload;

		chat.switchTo('thread-a');
		expect(uploadState(chat.ctx)).toMatchObject({ status: 'success', fileId: 'file-parked' });
	});

	it('keeps a failure that happened while parked recoverable', async () => {
		const transfer = pendingTransfer();
		const chat = threadedChat('thread-a');
		const upload = chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo('thread-b');
		transfer.reject(new Error('network'));
		await upload;

		chat.switchTo('thread-a');
		expect(uploadState(chat.ctx)).toMatchObject({ status: 'error' });

		const retry = pendingTransfer();
		chat.ctx.retryUpload(0);
		expect(uploadFileWithProgress).toHaveBeenCalledTimes(2);
		retry.succeed('file-retried');
		await vi.waitFor(() =>
			expect(uploadState(chat.ctx)).toMatchObject({ status: 'success', fileId: 'file-retried' })
		);
	});

	it('starts the transfer for an image parked while it was still encoding', async () => {
		// The encoder runs for seconds on a large photo, and the switch can land
		// in the middle of it. Looking for the attachment in the composer alone
		// would read the park as a discard and drop the file before it moved.
		const chat = threadedChat('thread-a');

		let finishEncoding!: () => void;
		const encoded = new Promise<void>((resolve) => {
			finishEncoding = resolve;
		});
		const transfer = pendingTransfer();

		const upload = chat.ctx.uploadFile(new Blob(['x'], { type: 'image/png' }), 'photo.png', {
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

		await vi.waitFor(() => expect(chat.ctx.attachments).toHaveLength(1));
		chat.switchTo('thread-b');
		finishEncoding();
		await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalledTimes(1));
		transfer.succeed('file-encoded');
		await upload;

		chat.switchTo('thread-a');
		expect(uploadState(chat.ctx)).toMatchObject({ status: 'success', fileId: 'file-encoded' });
	});

	it('takes the attachment back when a warm thread is handed out again', () => {
		// Asking for a new conversation drops the thread id and then gets the same
		// unused warm thread back. Treating that return as thread creation and
		// nothing else would leave the attachment parked under the id the user is
		// standing in: gone from the composer, still transferring.
		const transfer = pendingTransfer();
		const chat = threadedChat('warm-thread');
		void chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo(null);
		expect(chat.ctx.attachments).toHaveLength(0);

		chat.switchTo('warm-thread');
		expect(names(chat.ctx)).toEqual(['shot.png']);
		expect(transfer.canceled).toBe(false);
	});

	it('keeps what the composer holds when a new thread gets its id', () => {
		// The other half of the same transition: a file picked while the thread was
		// still being created belongs to it, so nothing may displace it.
		pendingTransfer();
		const chat = threadedChat('warm-thread');
		chat.switchTo(null);
		void chat.ctx.uploadScreenshot(shot(), 'picked-while-new.png');

		chat.switchTo('fresh-thread');
		expect(names(chat.ctx)).toEqual(['picked-while-new.png']);
	});

	it('merges both sides when a warm thread comes back to a busy composer', () => {
		// Both belong to the thread now: one was picked before stepping out, the
		// other while it had no id yet. Neither may displace the other.
		pendingTransfer();
		const chat = threadedChat('warm-thread');
		void chat.ctx.uploadScreenshot(shot(), 'before.png');

		pendingTransfer();
		chat.switchTo(null);
		void chat.ctx.uploadScreenshot(shot(), 'while-new.png');

		chat.switchTo('warm-thread');
		expect(names(chat.ctx)).toEqual(['before.png', 'while-new.png']);
	});

	it('does not end up with the same file twice after the merge', () => {
		// The composer's duplicate check only ever saw the live list, so the same
		// file can be picked again while the other copy sits parked.
		const first = pendingTransfer();
		const chat = threadedChat('warm-thread');
		void chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');

		const second = pendingTransfer();
		chat.switchTo(null);
		void chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');

		chat.switchTo('warm-thread');
		expect(names(chat.ctx)).toEqual(['notes.txt']);
		// The kept copy is the one already on the wire, and the other is called off.
		expect(first.canceled).toBe(false);
		expect(second.canceled).toBe(true);
	});

	it('keeps the copy that got further, not the one that was parked', () => {
		// The parked copy usually has the head start, but not when it failed. The
		// user would be handed back a tile to retry while the working transfer it
		// replaced was cancelled.
		const failing = pendingTransfer();
		const chat = threadedChat('warm-thread');
		const failed = chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');
		failing.reject(new Error('network'));

		return failed.then(async () => {
			const fresh = pendingTransfer();
			chat.switchTo(null);
			void chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');
			await vi.waitFor(() => expect(chat.ctx.attachments).toHaveLength(1));

			chat.switchTo('warm-thread');
			expect(names(chat.ctx)).toEqual(['notes.txt']);
			expect(uploadState(chat.ctx)).toMatchObject({ status: 'uploading' });
			expect(fresh.canceled).toBe(false);
		});
	});

	it('keeps the copy that is further along, not the one that waited longer', async () => {
		// Both are still moving, so the head start is only an assumption: the
		// parked transfer can be stalled at the start while the one picked again
		// is nearly done. Cancelling that one would throw away the better attempt.
		const stalled = pendingTransfer();
		const chat = threadedChat('warm-thread');
		void chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');
		await vi.waitFor(() => expect(chat.ctx.attachments).toHaveLength(1));

		const nearlyDone = pendingTransfer();
		chat.switchTo(null);
		void chat.ctx.uploadFile(new Blob(['x'], { type: 'text/plain' }), 'notes.txt');
		await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalledTimes(2));
		nearlyDone.progress(99);

		chat.switchTo('warm-thread');
		expect(names(chat.ctx)).toEqual(['notes.txt']);
		expect(uploadState(chat.ctx)).toMatchObject({ progress: 99 });
		expect(nearlyDone.canceled).toBe(false);
		expect(stalled.canceled).toBe(true);
	});

	it('files a parked upload under the thread it was picked in', () => {
		// Every surface derives the access key from the thread on screen, and the
		// key is what the stored file is filed under. Reading it when the encoder
		// finally hands over would file the image in the thread the user moved to.
		const transfer = pendingTransfer();
		const core = { threadId: 'thread-a' } as unknown as ChatCore;
		const keyedConfig = {
			...uploadConfig,
			getAccessKey: () => core.threadId ?? undefined
		} as ConstructorParameters<typeof ChatUIContext>[2];
		const ctx = new ChatUIContext(core, {} as ConvexClient, keyedConfig, 'right', null);
		ctx.setDisplayMessages([]);

		let finishEncoding!: () => void;
		const encoded = new Promise<void>((resolve) => {
			finishEncoding = resolve;
		});
		const upload = ctx.uploadFile(new Blob(['x'], { type: 'image/png' }), 'photo.png', {
			preprocess: async (input) => {
				await encoded;
				return {
					blob: input,
					mimeType: 'image/webp',
					filename: 'photo.webp',
					width: 10,
					height: 10
				};
			}
		});

		return vi
			.waitFor(() => expect(ctx.attachments).toHaveLength(1))
			.then(async () => {
				(core as { threadId: string }).threadId = 'thread-b';
				ctx.setDisplayMessages([]);
				finishEncoding();
				await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalledTimes(1));

				expect(uploadFileWithProgress.mock.calls[0]?.[6]).toBe('thread-a');
				transfer.succeed();
				await upload;
			});
	});

	it('cancels parked transfers when the surface goes away', () => {
		// Nothing is coming back to pick them up, and the claim has to end with the
		// context or the page keeps asking about a file nobody can finish.
		const uploads = new ActiveUploads();
		const transfer = pendingTransfer();
		const chat = threadedChat('thread-a', uploads);
		void chat.ctx.uploadScreenshot(shot(), 'shot.png');
		chat.switchTo('thread-b');

		chat.ctx.dispose();

		expect(transfer.canceled).toBe(true);
		expect(uploads.any).toBe(false);
	});

	it('keeps asking before a reload while a parked transfer runs', () => {
		// The bytes still die with the document, whichever thread is on screen.
		const uploads = new ActiveUploads();
		const transfer = pendingTransfer();
		const chat = threadedChat('thread-a', uploads);
		void chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo('thread-b');
		expect(uploads.any).toBe(true);

		transfer.succeed();
	});
});
