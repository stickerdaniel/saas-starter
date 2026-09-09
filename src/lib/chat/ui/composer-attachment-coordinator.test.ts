import { api } from '$lib/convex/_generated/api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { MAX_ATTACHMENTS, type Attachment } from '../core/types.js';

const uploadFileWithProgress = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', () => ({
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args),
	UploadError: class UploadError extends Error {}
}));

const { ComposerAttachmentCoordinator } =
	await import('./composer-attachment-coordinator.svelte.ts');

type Coordinator = InstanceType<typeof ComposerAttachmentCoordinator>;

const uploadConfig = {
	generateUploadUrl: api.support.files.generateUploadUrl,
	saveUploadedFile: api.support.files.saveUploadedFile
} satisfies NonNullable<
	ConstructorParameters<typeof ComposerAttachmentCoordinator>[0]['uploadConfig']
>;

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

const coordinators: Coordinator[] = [];
function coordinatorAt(
	thread: { current: string | null },
	activeUploads?: { claim(owner: object): void; release(owner: object): void }
): Coordinator {
	const coordinator = new ComposerAttachmentCoordinator({
		getThreadId: () => thread.current,
		client: {} as ConvexClient,
		uploadConfig,
		activeUploads
	});
	coordinators.push(coordinator);
	return coordinator;
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
	for (const coordinator of coordinators.splice(0)) coordinator.dispose();
	vi.restoreAllMocks();
});

describe('ComposerAttachmentCoordinator', () => {
	it('publishes source identity synchronously and transformed identity after preprocessing', async () => {
		uploadFileWithProgress.mockResolvedValue({
			url: 'https://cdn.test/photo.webp',
			fileId: 'file-photo'
		});
		const thread = { current: 'thread-a' };
		const coordinator = coordinatorAt(thread);
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

	it('owns the pick-time attachment cap even when called without ChatInput', async () => {
		const coordinator = coordinatorAt({ current: 'thread-a' });
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
		const thread = { current: 'thread-a' };
		const coordinator = coordinatorAt(thread);
		coordinator.syncThread();
		coordinator.addAttachments([successfulAttachment('from-a.png')]);

		thread.current = 'thread-b';
		expect(coordinator.syncThread()).toBe(true);
		expect(coordinator.attachments).toHaveLength(0);

		thread.current = 'thread-a';
		expect(coordinator.syncThread()).toBe(true);
		expect(coordinator.attachments).toMatchObject([{ name: 'from-a.png' }]);
	});

	it('rewrites a parked snapshot when its transfer finishes', async () => {
		const transfer = pendingTransfer();
		const thread = { current: 'thread-a' };
		const coordinator = coordinatorAt(thread);
		coordinator.syncThread();
		const upload = coordinator.uploadScreenshot(shot(), 'shot.png');

		thread.current = 'thread-b';
		coordinator.syncThread();
		expect(coordinator.attachments).toHaveLength(0);

		transfer.succeed('shot');
		await upload;
		thread.current = 'thread-a';
		coordinator.syncThread();

		expect(coordinator.attachments).toMatchObject([
			{
				name: 'shot.png',
				uploadState: { status: 'success', progress: 100, fileId: 'file-shot' }
			}
		]);
	});

	it('claims on the first pending transfer and releases after the last settles', async () => {
		const activeUploads = { claim: vi.fn(), release: vi.fn() };
		const coordinator = coordinatorAt({ current: 'thread-a' }, activeUploads);
		const first = pendingTransfer();
		const second = pendingTransfer();

		const firstUpload = coordinator.uploadScreenshot(shot(), 'one.png');
		const secondUpload = coordinator.uploadScreenshot(shot(), 'two.png');
		expect(activeUploads.claim).toHaveBeenCalledExactlyOnceWith(coordinator);

		first.succeed('one');
		await firstUpload;
		expect(activeUploads.release).not.toHaveBeenCalled();

		second.succeed('two');
		await secondUpload;
		expect(activeUploads.release).toHaveBeenCalledExactlyOnceWith(coordinator);
	});

	it('releases the global claim and blob preview when permanently disposed', () => {
		const owners = new Set<object>();
		const activeUploads = {
			claim: (owner: object) => owners.add(owner),
			release: (owner: object) => owners.delete(owner)
		};
		const coordinator = coordinatorAt({ current: 'thread-a' }, activeUploads);
		uploadFileWithProgress.mockImplementationOnce(() => new Promise(() => {}));
		void coordinator.uploadScreenshot(shot(), 'shot.png');
		expect(owners.has(coordinator)).toBe(true);

		coordinator.dispose();
		coordinator.dispose();

		expect(owners.has(coordinator)).toBe(false);
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/attachment');
	});
});
