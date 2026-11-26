import { describe, expect, it, vi } from 'vitest';
import { UploadError } from '../../uploads/transfer.js';
import type { AttachmentUploadResult } from '../core/file-uploader.js';
import type { Attachment } from '../core/types.js';
import {
	AttachmentRefusal,
	AttachmentTransfer,
	attachmentFileIdentity,
	attachmentProgressRank,
	isSameAttachmentFile,
	isStoredAttachment,
	revokeAttachmentPreview,
	type AttachmentTransferOptions,
	type AttachmentTransferPayload,
	type AttachmentTransferResult,
	type AttachmentTransferSnapshot,
	type AttachmentTransferUpload
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

const success: AttachmentUploadResult = {
	fileId: 'file-1',
	url: 'https://cdn.test/file-1'
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
		const uploadResult = deferred<AttachmentUploadResult>();
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
		const first = deferred<AttachmentUploadResult>();
		const second = deferred<AttachmentUploadResult>();
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

describe('AttachmentTransfer result handoff', () => {
	const surfaceResult: AttachmentUploadResult = { fileId: 'upload-7', url: '/attachments/7' };

	it('stops before transport when invalidated while measuring the processed image', async () => {
		const measuring = deferred<{ width: number; height: number }>();
		const measure = vi.fn(() => measuring.promise);
		const upload = vi.fn();
		const release = vi.fn();
		const transfer = new AttachmentTransfer({
			key: 'attachment-measure',
			blob: new Blob(['source'], { type: 'image/png' }),
			filename: 'photo.png',
			mimeType: 'image/png',
			upload,
			release,
			readImageDimensions: measure,
			onSnapshot: () => {}
		});

		const pending = transfer.start(async () => ({
			blob: new Blob(['passthrough'], { type: 'image/gif' }),
			mimeType: 'image/gif'
		}));
		await vi.waitFor(() => expect(measure).toHaveBeenCalledOnce());
		transfer.dispose();
		measuring.resolve({ width: 4, height: 4 });

		await expect(pending).resolves.toEqual({ status: 'invalidated' });
		expect(upload).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();
	});

	it('hands a success from a superseded attempt to release instead of publishing it', async () => {
		const first = deferred<AttachmentUploadResult>();
		const second = deferred<AttachmentUploadResult>();
		const release = vi.fn();
		const snapshots: AttachmentTransferSnapshot[] = [];
		let attempt = 0;
		const transfer = new AttachmentTransfer({
			key: 'attachment-superseded',
			blob: new Blob(['payload'], { type: 'text/plain' }),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: () => (++attempt === 1 ? first.promise : second.promise),
			release,
			onSnapshot: (snapshot) => snapshots.push(snapshot)
		});

		const firstAttempt = transfer.start();
		const secondAttempt = transfer.retry();
		first.resolve(surfaceResult);
		await expect(firstAttempt).resolves.toEqual({ status: 'invalidated' });

		expect(release).toHaveBeenCalledExactlyOnceWith(surfaceResult);
		expect(snapshots.some((snapshot) => snapshot.fileId === 'upload-7')).toBe(false);

		second.resolve({ fileId: 'upload-8', url: '/attachments/8' });
		await expect(secondAttempt).resolves.toEqual({ status: 'success' });
		expect(release).toHaveBeenCalledOnce();
		expect(snapshots.at(-1)).toMatchObject({ phase: 'success', fileId: 'upload-8' });
	});
});

describe('AttachmentTransfer lifecycle', () => {
	const result = (n: number): AttachmentUploadResult => ({ fileId: `upload-${n}`, url: `/a/${n}` });

	function harness(
		options: Partial<AttachmentTransferOptions> & Pick<AttachmentTransferOptions, 'upload'>
	) {
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		const release = vi.fn();
		const onAttemptError = vi.fn();
		const transfer = new AttachmentTransfer({
			key: 'attachment-lifecycle',
			blob: new Blob(['payload'], { type: 'text/plain' }),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			release,
			onAttemptError,
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active),
			...options
		});
		return { transfer, snapshots, activity, release, onAttemptError };
	}

	function scriptedUpload(count: number) {
		const attempts = Array.from({ length: count }, () => deferred<AttachmentUploadResult>());
		const payloads: AttachmentTransferPayload[] = [];
		const progress: Array<(value: number) => void> = [];
		const signals: AbortSignal[] = [];
		const upload: AttachmentTransferUpload = (payload, onProgress, signal) => {
			const attempt = attempts[payloads.length];
			if (!attempt) throw new Error('unexpected attempt');
			payloads.push(payload);
			progress.push(onProgress);
			signals.push(signal);
			return attempt.promise;
		};
		return { attempts, payloads, progress, signals, upload };
	}

	it('keeps the payload for a retry after the current transport aborts', async () => {
		const script = scriptedUpload(2);
		const { transfer, snapshots, activity, onAttemptError } = harness({ upload: script.upload });

		const first = transfer.start();
		const published = snapshots.length;
		script.attempts[0]!.reject(new DOMException('The operation was aborted.', 'AbortError'));

		await expect(first).resolves.toEqual({ status: 'invalidated' });
		expect(snapshots).toHaveLength(published);
		expect(onAttemptError).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);

		const second = transfer.retry();
		script.attempts[1]!.resolve(result(2));
		await expect(second).resolves.toEqual({ status: 'success' });
		expect(script.payloads[1]).toBe(script.payloads[0]);
		expect(snapshots.at(-1)).toMatchObject({ phase: 'success', fileId: 'upload-2' });
	});

	it.each([
		['a text file', { mimeType: 'text/plain', filename: 'notes.txt' }],
		[
			'a screenshot',
			{ mimeType: 'image/png', filename: 'screenshot.png', dimensions: { width: 8, height: 6 } }
		]
	])('refuses %s whose final payload fails the check before any transport', async (_, file) => {
		const refusal = new AttachmentRefusal('Too large');
		const upload = vi.fn<AttachmentTransferUpload>();
		const { transfer, snapshots, activity } = harness({
			...file,
			blob: new Blob(['payload'], { type: file.mimeType }),
			upload,
			checkPayload: () => {
				throw refusal;
			}
		});

		const outcome = await transfer.start();

		expect(outcome).toEqual({ status: 'preprocess-failed', error: refusal });
		expect(outcome.status === 'preprocess-failed' && outcome.error).toBe(refusal);
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
		expect(snapshots.at(-1)?.phase).toBe('uploading');
	});

	it('publishes each progress value of the current attempt only', async () => {
		const script = scriptedUpload(2);
		const { transfer, snapshots } = harness({ upload: script.upload });

		void transfer.start();
		for (const value of [0, 37, 100]) script.progress[0]!(value);
		expect(snapshots.slice(-3).map((snapshot) => snapshot.progress)).toEqual([0, 37, 100]);

		void transfer.retry();
		const published = snapshots.length;
		script.progress[0]!(99);

		expect(snapshots).toHaveLength(published);
		expect(snapshots.at(-1)).toMatchObject({ phase: 'uploading', progress: 0 });
	});

	it('releases each obsolete success once across three attempts', async () => {
		const script = scriptedUpload(3);
		const { transfer, snapshots, release } = harness({ upload: script.upload });

		const first = transfer.start();
		const second = transfer.retry();
		const third = transfer.retry();
		const published = snapshots.length;
		script.progress[0]!(50);
		expect(snapshots).toHaveLength(published);

		const late = [result(1), result(2)];
		script.attempts[0]!.resolve(late[0]!);
		script.attempts[1]!.resolve(late[1]!);
		script.attempts[2]!.resolve(result(3));

		await expect(first).resolves.toEqual({ status: 'invalidated' });
		await expect(second).resolves.toEqual({ status: 'invalidated' });
		await expect(third).resolves.toEqual({ status: 'success' });
		await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(2));
		expect(release.mock.calls.map(([handed]) => handed)).toEqual(late);
		expect(release.mock.calls[0]![0]).toBe(late[0]);
		expect(release.mock.calls[1]![0]).toBe(late[1]);
		expect(snapshots.at(-1)).toMatchObject({ phase: 'success', fileId: 'upload-3' });
	});

	it.each(['rejects', 'throws'] as const)(
		'hands the identical error to onAttemptError when the transport %s',
		async (mode) => {
			const failure = new UploadError('network');
			const { transfer, snapshots, onAttemptError } = harness({
				upload: () => {
					if (mode === 'throws') throw failure;
					return Promise.reject(failure);
				}
			});

			await expect(transfer.start()).resolves.toEqual({ status: 'error' });

			expect(onAttemptError).toHaveBeenCalledOnce();
			expect(onAttemptError.mock.calls[0]![0]).toBe(failure);
			expect(snapshots.at(-1)).toMatchObject({ phase: 'error', error: 'network', progress: 0 });
		}
	);

	it('resolves a superseded start before its transport settles and releases the late result', async () => {
		const script = scriptedUpload(2);
		const { transfer, snapshots, release } = harness({ upload: script.upload });

		const first = transfer.start();
		void transfer.retry();

		await expect(first).resolves.toEqual({ status: 'invalidated' });
		expect(release).not.toHaveBeenCalled();

		const late = result(1);
		script.attempts[0]!.resolve(late);
		await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
		expect(release.mock.calls[0]![0]).toBe(late);
		expect(snapshots.some((snapshot) => snapshot.fileId === 'upload-1')).toBe(false);
	});

	it('resolves a disposed upload before its transport settles and releases the late result', async () => {
		const script = scriptedUpload(1);
		const { transfer, snapshots, activity, release } = harness({ upload: script.upload });

		const pending = transfer.start();
		transfer.dispose();

		await expect(pending).resolves.toEqual({ status: 'invalidated' });
		const late = result(1);
		script.attempts[0]!.resolve(late);
		await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
		expect(release.mock.calls[0]![0]).toBe(late);
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('success');
		expect(activity).toEqual([true, false]);
	});

	it('resolves a start disposed during a preprocessor that never settles', async () => {
		const upload = vi.fn<AttachmentTransferUpload>();
		const { transfer, activity } = harness({ upload });

		const pending = transfer.start(() => new Promise(() => {}));
		transfer.dispose();

		await expect(pending).resolves.toEqual({ status: 'invalidated' });
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
	});

	it('finishes a preprocessed upload without interrupting its own start', async () => {
		const signals: AbortSignal[] = [];
		const { transfer, snapshots, release } = harness({
			blob: new Blob(['source'], { type: 'image/png' }),
			filename: 'photo.png',
			mimeType: 'image/png',
			upload: async (_payload, _onProgress, signal) => {
				signals.push(signal);
				return result(1);
			}
		});

		await expect(
			transfer.start(async () => ({
				blob: new Blob(['encoded'], { type: 'image/webp' }),
				mimeType: 'image/webp',
				filename: 'photo.webp',
				width: 4,
				height: 3
			}))
		).resolves.toEqual({ status: 'success' });

		expect(signals).toHaveLength(1);
		expect(signals[0]!.aborted).toBe(false);
		expect(release).not.toHaveBeenCalled();
		expect(snapshots.at(-1)).toMatchObject({ phase: 'success', fileId: 'upload-1' });
	});
});

describe('AttachmentTransfer observers', () => {
	const text = () => new Blob(['payload'], { type: 'text/plain' });

	function build(
		options: Partial<AttachmentTransferOptions> & Pick<AttachmentTransferOptions, 'upload'>
	) {
		const snapshots: AttachmentTransferSnapshot[] = [];
		const activity: boolean[] = [];
		const transfer = new AttachmentTransfer({
			key: 'attachment-observers',
			blob: text(),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			onSnapshot: (snapshot) => snapshots.push(snapshot),
			onActivityChange: (active) => activity.push(active),
			...options
		});
		return { transfer, snapshots, activity };
	}

	it('aborts the previous transport before a retry starts the next one', () => {
		const events: string[] = [];
		let calls = 0;
		const { transfer } = build({
			upload: (_payload, _onProgress, signal) => {
				const n = ++calls;
				events.push(`upload-${n}`);
				signal.addEventListener('abort', () => events.push(`abort-${n}`));
				return new Promise(() => {});
			}
		});

		void transfer.start();
		void transfer.retry();

		expect(events).toEqual(['upload-1', 'abort-1', 'upload-2']);
	});

	it('resolves a start whose first snapshot disposes the transfer', async () => {
		const upload = vi.fn<AttachmentTransferUpload>();
		const activity: boolean[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			key: 'attachment-observers',
			blob: text(),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload,
			onSnapshot: () => transfer.dispose(),
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'invalidated' });
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
	});

	it('refuses a retry that an abort listener requests during disposal', async () => {
		const retries: Array<Promise<AttachmentTransferResult>> = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			key: 'attachment-observers',
			blob: text(),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: (_payload, _onProgress, signal) => {
				signal.addEventListener('abort', () => {
					retries.push(transfer.retry());
				});
				return new Promise(() => {});
			},
			onSnapshot: () => {}
		});

		const pending = transfer.start();
		transfer.dispose();

		expect(retries).toHaveLength(1);
		await expect(retries[0]).resolves.toEqual({ status: 'unavailable' });
		await expect(pending).resolves.toEqual({ status: 'invalidated' });
	});

	it('keeps the error of an attempt whose error snapshot starts a retry', async () => {
		const second = deferred<AttachmentUploadResult>();
		const retries: Array<Promise<AttachmentTransferResult>> = [];
		let calls = 0;
		const activity: boolean[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			key: 'attachment-observers',
			blob: text(),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: () => (++calls === 1 ? Promise.reject(new UploadError('network')) : second.promise),
			onSnapshot: (snapshot) => {
				if (snapshot.phase === 'error' && retries.length === 0) {
					retries.push(transfer.retry());
				}
			},
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'error' });
		expect(calls).toBe(2);
		expect(activity).toEqual([true]);

		second.resolve({ fileId: 'upload-2', url: '/a/2' });
		await expect(retries[0]).resolves.toEqual({ status: 'success' });
		expect(activity).toEqual([true, false]);
	});

	it('settles a start whose onAttemptError throws as a refusal with that error', async () => {
		const thrown = new Error('observer failed');
		const { transfer, snapshots, activity } = build({
			upload: () => Promise.reject(new UploadError('network')),
			onAttemptError: () => {
				throw thrown;
			}
		});

		const outcome = await transfer.start();

		expect(outcome).toEqual({ status: 'preprocess-failed', error: thrown });
		expect(outcome.status === 'preprocess-failed' && outcome.error).toBe(thrown);
		expect(activity).toEqual([true, false]);
		expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('error');
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('rejects a retry whose onAttemptError throws and keeps the payload retryable', async () => {
		const thrown = new Error('observer failed');
		let errors = 0;
		const upload = vi.fn<AttachmentTransferUpload>(() =>
			Promise.reject(new UploadError('network'))
		);
		const { transfer, snapshots, activity } = build({
			upload,
			onAttemptError: () => {
				if (++errors === 2) throw thrown;
			}
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'error' });
		const published = snapshots.length;
		await expect(transfer.retry()).rejects.toBe(thrown);

		expect(activity).toEqual([true, false, true, false]);
		expect(snapshots.slice(published).map((snapshot) => snapshot.phase)).toEqual(['uploading']);
		await expect(transfer.retry()).resolves.toEqual({ status: 'error' });
		expect(upload).toHaveBeenCalledTimes(3);
	});

	it('publishes nothing after onAttemptError disposes the transfer', async () => {
		const phases: string[] = [];
		const activity: boolean[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			key: 'attachment-observers',
			blob: text(),
			filename: 'notes.txt',
			mimeType: 'text/plain',
			upload: () => Promise.reject(new UploadError('network')),
			onAttemptError: () => transfer.dispose(),
			onSnapshot: (snapshot) => phases.push(snapshot.phase),
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'error' });

		expect(phases).not.toContain('error');
		expect(activity).toEqual([true, false]);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	const source = () => ({
		key: 'attachment-observers',
		blob: text(),
		filename: 'notes.txt',
		mimeType: 'text/plain'
	});
	const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('resolves a retry whose abort listener disposes the transfer without a second upload', async () => {
		const first = deferred<AttachmentUploadResult>();
		const released: string[] = [];
		const upload = vi.fn<AttachmentTransferUpload>((_payload, _onProgress, signal) => {
			signal.addEventListener('abort', () => transfer.dispose());
			return first.promise;
		});
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload,
			onSnapshot: () => {},
			release: (result) => released.push(result.fileId)
		});

		const started = transfer.start();
		await expect(transfer.retry()).resolves.toEqual({ status: 'invalidated' });
		first.resolve({ fileId: 'upload-1', url: '/a/1' });

		await expect(started).resolves.toEqual({ status: 'invalidated' });
		await settled();
		expect(upload).toHaveBeenCalledTimes(1);
		expect(released).toEqual(['upload-1']);
	});

	it('lets a retry win over the retry its abort listener starts', async () => {
		const { attempts, signals, upload } = scripted(3);
		const released: string[] = [];
		const nested: Array<Promise<AttachmentTransferResult>> = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload: (payload, onProgress, signal) => {
				if (signals.length === 0) {
					signal.addEventListener('abort', () => nested.push(transfer.retry()));
				}
				return upload(payload, onProgress, signal);
			},
			onSnapshot: () => {},
			release: (result) => released.push(result.fileId)
		});

		const started = transfer.start();
		const outer = transfer.retry();
		attempts.forEach((attempt, index) =>
			attempt.resolve({ fileId: `upload-${index + 1}`, url: `/a/${index + 1}` })
		);

		await expect(Promise.all([started, outer, ...nested])).resolves.toEqual([
			{ status: 'invalidated' },
			{ status: 'success' },
			{ status: 'invalidated' }
		]);
		await settled();
		expect(released).toEqual(['upload-1', 'upload-2']);
		expect(signals.map((signal) => signal.aborted)).toEqual([true, true, false]);
	});

	it('keeps a retry that onAttemptError starts active and unreplaced', async () => {
		const second = deferred<AttachmentUploadResult>();
		const retries: Array<Promise<AttachmentTransferResult>> = [];
		const phases: string[] = [];
		const activity: boolean[] = [];
		let calls = 0;
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload: () => (++calls === 1 ? Promise.reject(new UploadError('network')) : second.promise),
			onAttemptError: () => retries.push(transfer.retry()),
			onSnapshot: (snapshot) => phases.push(snapshot.phase),
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'error' });
		expect(activity).toEqual([true]);
		expect(phases).toEqual(['uploading', 'uploading', 'uploading']);

		second.resolve({ fileId: 'upload-2', url: '/a/2' });
		await expect(Promise.all(retries)).resolves.toEqual([{ status: 'success' }]);
		expect(activity).toEqual([true, false]);
		expect(phases.at(-1)).toBe('success');
	});

	it('reports a throwing success snapshot as an attempt error', async () => {
		const thrown = new Error('observer failed');
		const errors: unknown[] = [];
		const phases: string[] = [];
		const { transfer, activity } = build({
			upload: () => Promise.resolve(success),
			onSnapshot: (snapshot) => {
				phases.push(snapshot.phase);
				if (snapshot.phase === 'success') throw thrown;
			},
			onAttemptError: (error) => errors.push(error)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'error' });

		expect(errors).toHaveLength(1);
		expect(errors[0]).toBe(thrown);
		expect(phases).toEqual(['uploading', 'uploading', 'success', 'error']);
		expect(activity).toEqual([true, false]);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('refuses a start whose error snapshot throws, with that error', async () => {
		const thrown = new Error('observer failed');
		const { transfer, activity } = build({
			upload: () => Promise.reject(new UploadError('network')),
			onSnapshot: (snapshot) => {
				if (snapshot.phase === 'error') throw thrown;
			}
		});

		const outcome = await transfer.start();

		expect(outcome).toEqual({ status: 'preprocess-failed', error: thrown });
		expect(outcome.status === 'preprocess-failed' && outcome.error).toBe(thrown);
		expect(activity).toEqual([true, false]);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('invalidates a start whose onAttemptError disposes the transfer and then throws', async () => {
		const activity: boolean[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload: () => Promise.reject(new UploadError('network')),
			onAttemptError: () => {
				transfer.dispose();
				throw new Error('observer failed');
			},
			onSnapshot: () => {},
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).resolves.toEqual({ status: 'invalidated' });
		expect(activity).toEqual([true, false]);
	});

	it('keeps a throwing release away from unhandled rejections', async () => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			const { attempts, upload } = scripted(2);
			const { transfer } = build({
				upload,
				release: () => {
					throw new Error('release failed');
				}
			});

			const started = transfer.start();
			const retried = transfer.retry();
			attempts.forEach((attempt) => attempt.resolve(success));

			await expect(Promise.all([started, retried])).resolves.toEqual([
				{ status: 'invalidated' },
				{ status: 'success' }
			]);
			await settled();
			await settled();
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it('aborts the signal of an attempt whose onAttemptError disposes the transfer', async () => {
		const signals: AbortSignal[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload: (_payload, _onProgress, signal) => {
				signals.push(signal);
				return Promise.reject(new UploadError('network'));
			},
			onAttemptError: () => transfer.dispose(),
			onSnapshot: () => {}
		});

		await transfer.start();

		expect(signals.map((signal) => signal.aborted)).toEqual([true]);
	});

	it('refuses a start whose attempt snapshot throws, before any upload', async () => {
		const thrown = new Error('observer failed');
		const upload = vi.fn<AttachmentTransferUpload>();
		let uploading = 0;
		const { transfer, activity } = build({
			upload,
			onSnapshot: (snapshot) => {
				if (snapshot.phase === 'uploading' && ++uploading === 2) throw thrown;
			}
		});

		const outcome = await transfer.start();

		expect(outcome).toEqual({ status: 'preprocess-failed', error: thrown });
		expect(outcome.status === 'preprocess-failed' && outcome.error).toBe(thrown);
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('refuses a finished start whose inactive report throws, with that error', async () => {
		const thrown = new Error('observer failed');
		const phases: string[] = [];
		const { transfer } = build({
			upload: () => Promise.resolve(success),
			onSnapshot: (snapshot) => phases.push(snapshot.phase),
			onActivityChange: (active) => {
				if (!active) throw thrown;
			}
		});

		const outcome = await transfer.start();

		expect(outcome).toEqual({ status: 'preprocess-failed', error: thrown });
		expect(outcome.status === 'preprocess-failed' && outcome.error).toBe(thrown);
		expect(phases).toEqual(['uploading', 'uploading', 'success']);
		await expect(transfer.retry()).resolves.toEqual({ status: 'unavailable' });
	});

	it('rejects a start whose first snapshot disposes the transfer and then throws', async () => {
		const thrown = new Error('observer failed');
		const upload = vi.fn<AttachmentTransferUpload>();
		const activity: boolean[] = [];
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...source(),
			upload,
			onSnapshot: () => {
				transfer.dispose();
				throw thrown;
			},
			onActivityChange: (active) => activity.push(active)
		});

		await expect(transfer.start()).rejects.toBe(thrown);
		expect(upload).not.toHaveBeenCalled();
		expect(activity).toEqual([true, false]);
	});

	it('drops progress from an attempt that already settled', async () => {
		const progress: Array<(value: number) => void> = [];
		let errors = 0;
		const { transfer, snapshots } = build({
			upload: (_payload, onProgress) => {
				progress.push(onProgress);
				return Promise.reject(new UploadError('network'));
			},
			onAttemptError: () => {
				if (++errors === 2) throw new Error('observer failed');
			}
		});

		await transfer.start();
		await expect(transfer.retry()).rejects.toThrow('observer failed');
		const published = snapshots.length;
		progress.forEach((report) => report(50));

		expect(progress).toHaveLength(2);
		expect(snapshots).toHaveLength(published);
	});

	function scripted(count: number) {
		const attempts = Array.from({ length: count }, () => deferred<AttachmentUploadResult>());
		const signals: AbortSignal[] = [];
		const upload: AttachmentTransferUpload = (_payload, _onProgress, signal) => {
			const attempt = attempts[signals.length];
			if (!attempt) throw new Error('unexpected attempt');
			signals.push(signal);
			return attempt.promise;
		};
		return { attempts, signals, upload };
	}

	it('hands each caller its own result object', async () => {
		const pending = () =>
			build({ upload: () => new Promise<AttachmentUploadResult>(() => {}) }).transfer;
		const [first, second] = [pending(), pending()];
		const started = [first.start(), second.start()];
		first.dispose();
		second.dispose();

		const results = [...(await Promise.all(started)), await first.retry(), await second.retry()];

		expect(results).toEqual([
			{ status: 'invalidated' },
			{ status: 'invalidated' },
			{ status: 'unavailable' },
			{ status: 'unavailable' }
		]);
		expect(new Set(results).size).toBe(4);
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
