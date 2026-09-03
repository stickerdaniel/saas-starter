import { describe, expect, it, vi } from 'vitest';
import { UploadError } from '../../uploads/transfer.js';
import type { UploadResult } from '../core/file-uploader.js';
import type { Attachment } from '../core/types.js';
import {
	AttachmentTransfer,
	attachmentFileIdentity,
	attachmentProgressRank,
	isSameAttachmentFile,
	isStoredAttachment,
	revokeAttachmentPreview,
	type AttachmentTransferPayload,
	type AttachmentTransferSnapshot
} from './attachment-transfer.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const success: UploadResult = {
	fileId: 'file-1',
	url: 'https://cdn.test/file-1',
	storageId: 'storage-1'
};

describe('AttachmentTransfer', () => {
	it('invalidates preprocessing without starting transport', async () => {
		const preprocessing = deferred<{
			blob: Blob;
			mimeType: string;
			filename: string;
			width: number;
			height: number;
		}>();
		const upload = vi.fn();
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		const source = new Blob(['source'], { type: 'image/png' });
		const transfer = new AttachmentTransfer({
			key: 'attachment-1',
			blob: source,
			filename: 'photo.png',
			mimeType: source.type,
			upload,
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active)
		});

		const pending = transfer.start(() => preprocessing.promise);
		expect(snapshots.at(-1)?.phase).toBe('preprocessing');
		expect(activity).toEqual([true]);

		transfer.dispose();
		preprocessing.resolve({
			blob: new Blob(['encoded'], { type: 'image/webp' }),
			mimeType: 'image/webp',
			filename: 'photo.webp',
			width: 640,
			height: 480
		});

		await expect(pending).resolves.toEqual({ status: 'invalidated' });
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('success');
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('error');
	});

	it('aborts active transport and ignores its late completion on disposal', async () => {
		const uploadResult = deferred<UploadResult>();
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		let signal: AbortSignal | undefined;
		const transfer = new AttachmentTransfer({
			key: 'attachment-abort',
			blob: new Blob(['payload'], { type: 'text/plain' }),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: (_payload, _onProgress, attemptSignal) => {
				signal = attemptSignal;
				return uploadResult.promise;
			},
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active)
		});

		const pending = transfer.start();
		expect(signal?.aborted).toBe(false);
		transfer.dispose();
		expect(signal?.aborted).toBe(true);
		uploadResult.resolve(success);

		await expect(pending).resolves.toEqual({ status: 'invalidated' });
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('success');
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('error');
		expect(activity).toEqual([true, false]);
	});

	it('retries with the exact retained post-preprocess payload', async () => {
		const processed = new Blob(['encoded'], { type: 'image/webp' });
		const payloads: AttachmentTransferPayload[] = [];
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		const upload = vi.fn(async (payload: AttachmentTransferPayload) => {
			payloads.push(payload);
			if (payloads.length === 1) throw new UploadError('network');
			return success;
		});
		const transfer = new AttachmentTransfer({
			key: 'attachment-2',
			blob: new Blob(['source'], { type: 'image/png' }),
			filename: 'photo.png',
			mimeType: 'image/png',
			accessKey: 'thread-a',
			upload,
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active)
		});

		await expect(
			transfer.start(async () => ({
				blob: processed,
				mimeType: 'image/webp',
				filename: 'photo.webp',
				width: 800,
				height: 600
			}))
		).resolves.toEqual({ status: 'error' });
		await expect(transfer.retry()).resolves.toEqual({ status: 'success' });

		expect(payloads).toHaveLength(2);
		expect(payloads[1]).toBe(payloads[0]);
		expect(payloads[0]).toEqual({
			blob: processed,
			filename: 'photo.webp',
			mimeType: 'image/webp',
			dimensions: { width: 800, height: 600 },
			accessKey: 'thread-a'
		});
		expect(snapshots.find((snapshot) => snapshot.phase === 'error')?.error).toBe('network');
		expect(snapshots.at(-1)).toMatchObject({
			phase: 'success',
			progress: 100,
			fileId: 'file-1',
			url: 'https://cdn.test/file-1'
		});
		expect(activity).toEqual([true, false, true, false]);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('rejects progress and failure from a superseded attempt', async () => {
		const first = deferred<UploadResult>();
		const second = deferred<UploadResult>();
		const progress: Array<(value: number) => void> = [];
		const signals: AbortSignal[] = [];
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		let attempt = 0;
		const transfer = new AttachmentTransfer({
			key: 'attachment-3',
			blob: new Blob(['payload'], { type: 'text/plain' }),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: (_payload, onProgress, signal) => {
				progress.push(onProgress);
				signals.push(signal);
				attempt += 1;
				return attempt === 1 ? first.promise : second.promise;
			},
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active)
		});

		const firstAttempt = transfer.start();
		expect(progress).toHaveLength(1);
		const secondAttempt = transfer.retry();
		expect(progress).toHaveLength(2);
		expect(signals[0]!.aborted).toBe(true);

		second.resolve(success);
		await expect(secondAttempt).resolves.toEqual({ status: 'success' });
		const settledSnapshots = snapshots.length;

		progress[0]!(97);
		first.reject(new UploadError('http', 503));
		await expect(firstAttempt).resolves.toEqual({ status: 'invalidated' });

		expect(snapshots).toHaveLength(settledSnapshots);
		expect(snapshots.at(-1)?.phase).toBe('success');
		expect(activity).toEqual([true, false]);
	});
});

describe('attachment transfer helpers', () => {
	it('keeps source identity after transformed metadata changes', () => {
		const transformed: Attachment = {
			type: 'file',
			name: 'photo.webp',
			size: 7,
			mimeType: 'image/webp',
			sourceName: 'photo.png',
			sourceSize: 12,
			uploadState: { status: 'uploading', progress: 40 }
		};
		const source: Attachment = {
			type: 'file',
			name: 'photo.png',
			size: 12,
			mimeType: 'image/png'
		};

		expect(attachmentFileIdentity(transformed)).toEqual(['photo.webp:7', 'photo.png:12']);
		expect(isSameAttachmentFile(transformed, source)).toBe(true);
	});

	it('ranks storage, progress, and failure and requires complete stored references', () => {
		const uploaded: Attachment = {
			type: 'file',
			name: 'done.txt',
			size: 1,
			mimeType: 'text/plain',
			url: 'https://cdn.test/done',
			uploadState: { status: 'success', progress: 100, fileId: 'file-done' }
		};
		const moving: Attachment = {
			...uploaded,
			url: undefined,
			uploadState: { status: 'uploading', progress: 73 }
		};
		const failed: Attachment = {
			...uploaded,
			url: undefined,
			uploadState: { status: 'error', progress: 0, error: 'network' }
		};

		expect(attachmentProgressRank(uploaded)).toBeGreaterThan(attachmentProgressRank(moving));
		expect(attachmentProgressRank(moving)).toBeGreaterThan(attachmentProgressRank(failed));
		expect(isStoredAttachment(uploaded)).toBe(true);
		expect(isStoredAttachment({ ...uploaded, url: undefined })).toBe(false);
	});

	it('revokes only blob previews', () => {
		const revoke = vi.fn();
		revokeAttachmentPreview(
			{
				type: 'screenshot',
				name: 'shot.png',
				size: 1,
				mimeType: 'image/png',
				preview: 'blob:preview'
			},
			revoke
		);
		revokeAttachmentPreview(
			{
				type: 'image',
				url: 'https://cdn.test/image',
				filename: 'image.png'
			},
			revoke
		);

		expect(revoke).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledWith('blob:preview');
	});
});
