/**
 * An uploaded attachment survives a reload.
 *
 * The text a user left in the composer already comes back after a refresh, and
 * the file next to it used to be the one thing that did not, even though it was
 * on the server the whole time. Each test builds a second context over the same
 * storage: that is what a reloaded page is, a fresh context reading what the
 * last one left behind.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { ChatCore } from '../core/chat-core.svelte.ts';

const uploadFileWithProgress = vi.fn();

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', () => ({
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args),
	UploadError: class UploadError extends Error {}
}));

// jsdom's localStorage lacks the standard methods runed's PersistedState needs
const storage = new Map<string, string>();
const localStorageMock: Storage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => storage.set(key, value),
	removeItem: (key: string) => storage.delete(key),
	clear: () => storage.clear(),
	get length() {
		return storage.size;
	},
	key: (index: number) => [...storage.keys()][index] ?? null
};

const { ChatUIContext } = await import('./chat-context.svelte.ts');
const { ChatAttachmentStore } = await import('../core/chat-attachment-store.svelte.ts');

let surface: string;

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
		succeed: (fileId = 'file-1') => settle({ url: `https://example.test/${fileId}`, fileId }),
		reject: (error: unknown) => fail(error)
	};
}

/**
 * A chat on the surface under test, reading and writing the shared storage.
 *
 * `rendered: false` stands for a context whose chat was never mounted, which
 * the screenshot flow produces: it uploads through the context with the panel
 * closed, so `setDisplayMessages` may never run.
 */
function chatAt(threadId: string | null, { rendered = true } = {}) {
	const core = { threadId } as unknown as ChatCore;
	const uploadConfig = {
		generateUploadUrl: 'storage:generateUploadUrl',
		saveUploadedFile: 'storage:saveUploadedFile',
		attachmentStore: new ChatAttachmentStore(surface)
	} as unknown as ConstructorParameters<typeof ChatUIContext>[2];
	const ctx = new ChatUIContext(core, {} as ConvexClient, uploadConfig, 'right', null);
	// The first call is what gives the context a thread to compare against.
	if (rendered) ctx.setDisplayMessages([]);
	return {
		ctx,
		switchTo(next: string | null) {
			(core as { threadId: string | null }).threadId = next;
			ctx.setDisplayMessages([]);
		}
	};
}

const shot = () => new Blob(['x'], { type: 'image/png' });

/** Upload a screenshot and let it finish. */
async function uploadInto(ctx: InstanceType<typeof ChatUIContext>, filename: string, id: string) {
	const transfer = pendingTransfer();
	const upload = ctx.uploadScreenshot(shot(), filename);
	await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalled());
	transfer.succeed(id);
	await upload;
}

function names(ctx: InstanceType<typeof ChatUIContext>) {
	return ctx.attachments.map((a) => ('name' in a ? a.name : undefined));
}

describe('ChatUIContext persisted attachments', () => {
	beforeAll(() => {
		vi.stubGlobal('localStorage', localStorageMock);
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
		storage.clear();
		surface = 'test-' + Math.random();
	});

	it('hands an uploaded attachment back to the next page load', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'shot.png', 'file-kept');

		const reloaded = chatAt('thread-a');
		expect(names(reloaded.ctx)).toEqual(['shot.png']);
		expect(reloaded.ctx.uploadedFileIds).toEqual(['file-kept']);
	});

	it('leaves a transfer that never finished behind', async () => {
		const first = chatAt('thread-a');
		pendingTransfer();
		void first.ctx.uploadScreenshot(shot(), 'shot.png');
		await vi.waitFor(() => expect(first.ctx.attachments).toHaveLength(1));

		// The bytes were in memory and the file never reached the server, so
		// there is nothing to point a restored tile at.
		expect(chatAt('thread-a').ctx.attachments).toHaveLength(0);
	});

	it('leaves a transfer that failed behind', async () => {
		const first = chatAt('thread-a');
		const transfer = pendingTransfer();
		const upload = first.ctx.uploadScreenshot(shot(), 'shot.png');
		await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalled());
		transfer.reject(new Error('network'));
		await upload;

		expect(chatAt('thread-a').ctx.attachments).toHaveLength(0);
	});

	it('keeps what it was holding when the surface goes away', async () => {
		// Disposal empties both lists to release aborters and blob previews.
		// Saving that would erase exactly what the next load is meant to restore,
		// which would turn every unmount into the loss this exists to prevent.
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'shot.png', 'file-kept');
		first.ctx.dispose();

		expect(names(chatAt('thread-a').ctx)).toEqual(['shot.png']);
	});

	it('forgets an attachment the user removed', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'shot.png', 'file-kept');
		first.ctx.removeAttachment(0);

		expect(chatAt('thread-a').ctx.attachments).toHaveLength(0);
	});

	it('forgets attachments once the message carrying them was sent', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'shot.png', 'file-sent');
		first.ctx.clearAttachments();

		expect(chatAt('thread-a').ctx.attachments).toHaveLength(0);
	});

	it('hands it back only to the thread it was picked in', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'from-a.png', 'file-a');

		const reloaded = chatAt('thread-b');
		expect(reloaded.ctx.attachments).toHaveLength(0);

		reloaded.switchTo('thread-a');
		expect(names(reloaded.ctx)).toEqual(['from-a.png']);
	});

	it('hands back a composer that had no thread yet', async () => {
		// Nothing has been sent, so the conversation has no id to file this under.
		const first = chatAt(null);
		await uploadInto(first.ctx, 'shot.png', 'file-new');

		expect(names(chatAt(null).ctx)).toEqual(['shot.png']);
	});

	it('does not lose a stored composer to an upload that lands before the chat renders', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'earlier.png', 'file-earlier');

		// Left parked under the thread it is standing in, the stored file would be
		// written over by the very next save, and no render is coming to claim it.
		const unrendered = chatAt('thread-a', { rendered: false });
		await uploadInto(unrendered.ctx, 'later.png', 'file-later');

		expect(names(chatAt('thread-a').ctx).sort()).toEqual(['earlier.png', 'later.png']);
	});

	it('leaves a thread it only read to whichever page is standing in it', async () => {
		const seed = chatAt('thread-b');
		await uploadInto(seed.ctx, 'from-b.png', 'file-b');

		// Two tabs on the same chat. Both take thread-b off disk at startup; only
		// the second is in it. Writing the copy the first started with would undo
		// what the second does there.
		const otherTab = chatAt('thread-a');
		const inThreadB = chatAt('thread-b');
		await uploadInto(inThreadB.ctx, 'also-b.png', 'file-b2');
		await uploadInto(otherTab.ctx, 'from-a.png', 'file-a');

		expect(names(chatAt('thread-b').ctx).sort()).toEqual(['also-b.png', 'from-b.png']);
	});

	it('does not double up when the same file is restored and picked again', async () => {
		const first = chatAt('thread-a');
		await uploadInto(first.ctx, 'shot.png', 'file-kept');

		// Same thread, and the restored copy is already sitting in the composer.
		const reloaded = chatAt('thread-a');
		reloaded.switchTo('thread-b');
		reloaded.switchTo('thread-a');
		expect(names(reloaded.ctx)).toEqual(['shot.png']);
	});
});
