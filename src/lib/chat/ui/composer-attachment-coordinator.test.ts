import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { createChatSession } from '../__tests__/session-fixture';
import { MAX_ATTACHMENTS, type Attachment, type DisplayMessage } from '../core/types.js';

const uploadFileWithProgress = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', () => ({
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args),
	UploadError: class UploadError extends Error {}
}));

const { ChatUIContext } = await import('./chat-context.svelte.ts');
const { ChatComposer } = await import('./chat-composer.svelte.ts');

type Context = InstanceType<typeof ChatUIContext>;

const uploadConfig = {
	purpose: 'support'
} satisfies NonNullable<ConstructorParameters<typeof ChatUIContext>[3]>;

function successfulAttachment(name = 'saved.png'): Attachment {
	return {
		type: 'file',
		key: crypto.randomUUID(),
		name,
		size: 5,
		mimeType: 'image/png',
		url: `https://cdn.test/${name}`,
		uploadState: { status: 'success', progress: 100, fileId: `file-${name}` }
	};
}

function pendingTransfer() {
	let settle!: (result: { url: string; fileId: string }) => void;
	uploadFileWithProgress.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				settle = resolve;
			})
	);
	return {
		succeed: (suffix: string) =>
			settle({ url: `https://cdn.test/${suffix}`, fileId: `file-${suffix}` })
	};
}

const shot = () => new Blob(['x'], { type: 'image/png' });

const contexts: Context[] = [];
/** A view on its own composer, showing `threadId` and able to move to another thread. */
function composerAt(
	threadId: string | null,
	activeUploads: { claim(owner: object): void; release(owner: object): void } | null = null
) {
	const session = createChatSession(threadId);
	const ctx = new ChatUIContext(
		session,
		{} as ConvexClient,
		new ChatComposer(),
		uploadConfig,
		'right',
		activeUploads
	);
	contexts.push(ctx);
	return {
		ctx,
		switchTo(next: string | null) {
			session.moveTo(next);
			ctx.activate();
		}
	};
}

beforeAll(() => {
	if (!('createObjectURL' in URL)) {
		Object.defineProperty(URL, 'createObjectURL', {
			value: () => 'blob:http://localhost/attachment',
			writable: true,
			configurable: true
		});
	}
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
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/attachment');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
	for (const context of contexts.splice(0)) context.dispose();
	vi.restoreAllMocks();
});

describe('ComposerAttachmentCoordinator', () => {
	it('publishes source identity synchronously and transformed identity after preprocessing', async () => {
		uploadFileWithProgress.mockResolvedValue({
			url: 'https://cdn.test/photo.webp',
			fileId: 'file-photo'
		});
		const { ctx: coordinator } = composerAt('thread-a');
		const source = new File(['original'], 'photo.png', { type: 'image/png' });
		const transformed = new Blob(['normalized'], { type: 'image/webp' });
		let finishPreprocessing!: () => void;
		const preprocessing = new Promise<void>((resolve) => {
			finishPreprocessing = resolve;
		});

		const upload = coordinator.uploadFile(source, source.name, {
			preprocess: async () => {
				await preprocessing;
				return {
					blob: transformed,
					mimeType: transformed.type,
					filename: 'photo.webp',
					width: 10,
					height: 10
				};
			}
		});

		expect(coordinator.attachments).toHaveLength(1);
		expect(coordinator.hasFile(source.name, source.size)).toBe(true);
		expect(uploadFileWithProgress).not.toHaveBeenCalled();

		finishPreprocessing();
		await upload;

		expect(coordinator.hasFile(source.name, source.size)).toBe(true);
		expect(coordinator.hasFile('photo.webp', transformed.size)).toBe(true);
		expect(coordinator.attachments[0]).toMatchObject({
			type: 'file',
			file: source,
			name: 'photo.webp',
			sourceName: source.name,
			sourceSize: source.size,
			uploadState: { status: 'success', progress: 100 }
		});
	});

	it('uploads a prepared screenshot unchanged and cancels it on removal', async () => {
		uploadFileWithProgress.mockImplementationOnce(() => new Promise(() => {}));
		const { ctx: coordinator } = composerAt('thread-a');
		const blob = new Blob(['edited screenshot'], { type: 'image/png' });

		void coordinator.uploadScreenshot(blob, 'shot.png', { width: 640, height: 480 });

		expect(coordinator.attachments).toMatchObject([
			{
				type: 'screenshot',
				name: 'shot.png',
				size: blob.size,
				mimeType: 'image/png',
				width: 640,
				height: 480,
				uploadState: { status: 'uploading' }
			}
		]);
		await vi.waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalledOnce());
		const [payload, filename, , , dimensions, signal] = uploadFileWithProgress.mock.calls[0] as [
			Blob,
			string,
			unknown,
			unknown,
			unknown,
			AbortSignal
		];
		expect(payload.type).toBe('image/png');
		expect(await payload.text()).toBe('edited screenshot');
		expect(filename).toBe('shot.png');
		expect(dimensions).toEqual({ width: 640, height: 480 });
		expect(signal.aborted).toBe(false);

		coordinator.removeAttachment(0);

		expect(coordinator.attachments).toEqual([]);
		expect(signal.aborted).toBe(true);
	});

	it('owns the pick-time attachment cap even when called without ChatInput', async () => {
		const { ctx: coordinator } = composerAt('thread-a');
		coordinator.addAttachments(
			Array.from({ length: MAX_ATTACHMENTS }, (_, index) => ({
				type: 'image' as const,
				url: `https://example.test/${index}.png`
			}))
		);

		expect(coordinator.canAddAttachment).toBe(false);
		expect(coordinator.maxAttachments).toBe(MAX_ATTACHMENTS);
		await coordinator.uploadFile(new File(['x'], 'extra.txt', { type: 'text/plain' }));
		await coordinator.uploadScreenshot(shot(), 'extra.png');

		expect(coordinator.attachments).toHaveLength(MAX_ATTACHMENTS);
		expect(uploadFileWithProgress).not.toHaveBeenCalled();
	});

	it('parks and restores the live collection when moving between real threads', () => {
		const chat = composerAt('thread-a');
		chat.ctx.addAttachments([successfulAttachment('from-a.png')]);

		chat.switchTo('thread-b');
		expect(chat.ctx.attachments).toHaveLength(0);

		chat.switchTo('thread-a');
		expect(chat.ctx.attachments).toMatchObject([{ name: 'from-a.png' }]);
	});

	it('fades in the messages of each real thread it moves to, and not on assignment', () => {
		const message = (id: string): DisplayMessage => ({
			id,
			_creationTime: 0,
			order: 0,
			role: 'assistant',
			status: 'success',
			text: id,
			parts: [{ type: 'text', text: id, state: 'done' }],
			displayText: id,
			displayReasoning: '',
			isStreaming: false,
			hasReasoningStream: false
		});
		const fade = 'animate-in fade-in-0 duration-200';
		const chat = composerAt('thread-a');
		chat.ctx.setDisplayMessages([message('in-a')]);
		expect(chat.ctx.messagesFade.animationClass).toBe(fade);

		chat.switchTo('thread-b');
		expect(chat.ctx.messagesFade.animationClass).toBe('');
		chat.ctx.setDisplayMessages([message('in-b')]);
		expect(chat.ctx.messagesFade.animationClass).toBe(fade);

		chat.switchTo(null);
		expect(chat.ctx.messagesFade.animationClass).toBe('');
		chat.ctx.setDisplayMessages([message('in-new')]);
		chat.switchTo('thread-c');
		expect(chat.ctx.messagesFade.animationClass).toBe(fade);
	});

	it('rewrites a parked snapshot when its transfer finishes', async () => {
		const transfer = pendingTransfer();
		const chat = composerAt('thread-a');
		const upload = chat.ctx.uploadScreenshot(shot(), 'shot.png');

		chat.switchTo('thread-b');
		expect(chat.ctx.attachments).toHaveLength(0);

		transfer.succeed('shot');
		await upload;
		chat.switchTo('thread-a');

		expect(chat.ctx.attachments).toMatchObject([
			{
				name: 'shot.png',
				uploadState: { status: 'success', progress: 100, fileId: 'file-shot' }
			}
		]);
	});

	it('releases the global claim and blob preview when permanently disposed', () => {
		const owners = new Set<object>();
		const activeUploads = {
			claim: (owner: object) => owners.add(owner),
			release: (owner: object) => owners.delete(owner)
		};
		const { ctx } = composerAt('thread-a', activeUploads);
		uploadFileWithProgress.mockImplementationOnce(() => new Promise(() => {}));
		void ctx.uploadScreenshot(shot(), 'shot.png');
		expect(owners.size).toBe(1);

		ctx.dispose();
		ctx.dispose();

		expect(owners.size).toBe(0);
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/attachment');
	});
});
