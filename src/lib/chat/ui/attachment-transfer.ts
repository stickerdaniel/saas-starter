import type { UploadPreprocessor } from '../../uploads/transfer.js';
import { UploadError, type UploadErrorCode } from '../../uploads/transfer.js';
import type { Attachment } from '../core/types.js';
import type { UploadResult } from '../core/file-uploader.js';

const SETTLED_PROGRESS_RANK = 101;
const FAILED_PROGRESS_RANK = -1;

export type AttachmentDimensions = { width: number; height: number };

export type AttachmentPreprocess = UploadPreprocessor<File | Blob>;

/** The exact post-preprocessing input reused by every transport attempt. */
export type AttachmentTransferPayload = {
	readonly blob: File | Blob;
	readonly filename: string;
	readonly mimeType: string;
	readonly dimensions?: AttachmentDimensions;
	readonly accessKey?: string;
};

export type AttachmentTransferSnapshot = {
	readonly key: string;
	readonly sourceName: string;
	readonly sourceSize: number;
	readonly name: string;
	readonly mimeType: string;
	readonly size: number;
	readonly phase: 'preprocessing' | 'uploading' | 'success' | 'error';
	readonly progress: number;
	readonly dimensions?: AttachmentDimensions;
	readonly fileId?: string;
	readonly url?: string;
	readonly error?: UploadErrorCode;
};

export type AttachmentTransferResult =
	| { status: 'success' }
	| { status: 'error' }
	| { status: 'invalidated' }
	| { status: 'unavailable' }
	| { status: 'preprocess-failed'; error: unknown };

export type AttachmentTransferUpload = (
	payload: AttachmentTransferPayload,
	onProgress: (progress: number) => void,
	signal: AbortSignal
) => Promise<UploadResult>;

export type AttachmentTransferOptions = {
	key: string;
	blob: File | Blob;
	filename: string;
	mimeType: string;
	dimensions?: AttachmentDimensions;
	accessKey?: string;
	upload: AttachmentTransferUpload;
	measureImageDimensions?: boolean;
	readImageDimensions?: (blob: File | Blob) => Promise<AttachmentDimensions>;
	onSnapshot: (snapshot: AttachmentTransferSnapshot) => void;
	onActivityChange?: (active: boolean) => void;
	onAttemptError?: (error: unknown) => void;
};

/** A canceled transport, which should stay silent in attachment UI. */
export function isAttachmentTransferAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** Both names by which a picked file remains identifiable after preprocessing. */
export function attachmentFileIdentity(attachment: Attachment): string[] {
	if (attachment.type !== 'file' && attachment.type !== 'screenshot') return [];
	const identities = [`${attachment.name}:${attachment.size}`];
	if (attachment.sourceName !== undefined && attachment.sourceSize !== undefined) {
		identities.push(`${attachment.sourceName}:${attachment.sourceSize}`);
	}
	return identities;
}

export function isSameAttachmentFile(a: Attachment, b: Attachment): boolean {
	const other = attachmentFileIdentity(b);
	return attachmentFileIdentity(a).some((identity) => other.includes(identity));
}

/** A stored success wins over progress, which wins over a retryable failure. */
export function attachmentProgressRank(attachment: Attachment): number {
	const state = 'uploadState' in attachment ? attachment.uploadState : undefined;
	if (!state || state.status === 'success') return SETTLED_PROGRESS_RANK;
	if (state.status === 'error') return FAILED_PROGRESS_RANK;
	return state.progress;
}

/** Whether persistence has every reference needed to restore the attachment. */
export function isStoredAttachment(attachment: Attachment): boolean {
	if (!('uploadState' in attachment)) return false;
	const state = attachment.uploadState;
	return state?.status === 'success' && !!state.fileId && !!attachment.url;
}

/** Revoke only local object URLs; uploaded and remote URLs remain usable. */
export function revokeAttachmentPreview(
	attachment: Attachment,
	revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
): void {
	if ('preview' in attachment && attachment.preview?.startsWith('blob:')) {
		revoke(attachment.preview);
	}
}

function readImageDimensions(blob: File | Blob): Promise<AttachmentDimensions> {
	return new Promise((resolve) => {
		const image = new Image();
		const preview = URL.createObjectURL(blob);
		const finish = (dimensions: AttachmentDimensions) => {
			URL.revokeObjectURL(preview);
			resolve(dimensions);
		};
		image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
		image.onerror = () => finish({ width: 0, height: 0 });
		image.src = preview;
	});
}

/**
 * Owns one attachment's preprocessing and transport attempts.
 *
 * Composer collection, parking, persistence, and rendered attachment state stay
 * with ComposerAttachmentCoordinator; it receives only snapshots from this lifecycle owner.
 */
export class AttachmentTransfer {
	readonly key: string;
	readonly sourceName: string;
	readonly sourceSize: number;

	private sourceBlob: File | Blob | undefined;
	private name: string;
	private mimeType: string;
	private size: number;
	private dimensions?: AttachmentDimensions;
	private readonly accessKey?: string;
	private readonly upload: AttachmentTransferUpload;
	private readonly shouldMeasureImage: boolean;
	private readonly measureImage: (blob: File | Blob) => Promise<AttachmentDimensions>;
	private readonly onSnapshot: (snapshot: AttachmentTransferSnapshot) => void;
	private readonly onActivityChange?: (active: boolean) => void;
	private readonly onAttemptError?: (error: unknown) => void;

	private generation = 0;
	private controller: AbortController | undefined;
	private retryPayload: AttachmentTransferPayload | undefined;
	private phase: AttachmentTransferSnapshot['phase'] = 'uploading';
	private progress = 0;
	private result: Pick<AttachmentTransferSnapshot, 'fileId' | 'url' | 'error'> = {};
	private active = false;
	private started = false;
	private disposed = false;

	constructor(options: AttachmentTransferOptions) {
		this.key = options.key;
		this.sourceName = options.filename;
		this.sourceSize = options.blob.size;
		this.sourceBlob = options.blob;
		this.name = options.filename;
		this.mimeType = options.mimeType;
		this.size = options.blob.size;
		this.dimensions = options.dimensions;
		this.accessKey = options.accessKey;
		this.upload = options.upload;
		this.shouldMeasureImage = options.measureImageDimensions ?? true;
		this.measureImage = options.readImageDimensions ?? readImageDimensions;
		this.onSnapshot = options.onSnapshot;
		this.onActivityChange = options.onActivityChange;
		this.onAttemptError = options.onAttemptError;
	}

	/** Start preprocessing and the first transport attempt exactly once. */
	async start(preprocess?: AttachmentPreprocess): Promise<AttachmentTransferResult> {
		if (this.started || this.disposed || !this.sourceBlob) return { status: 'unavailable' };
		this.started = true;
		const generation = this.claimGeneration();
		this.setActive(true);
		this.phase = preprocess ? 'preprocessing' : 'uploading';
		this.progress = 0;
		this.result = {};
		this.publish();

		try {
			let blob = this.sourceBlob;
			let dimensions = this.dimensions;

			if (preprocess) {
				const processed = await preprocess(blob);
				if (!this.isCurrent(generation)) return { status: 'invalidated' };

				blob = processed.blob;
				this.name = processed.filename ?? this.name;
				this.mimeType = processed.mimeType;
				this.size = blob.size;
				const width = processed.width;
				const height = processed.height;
				dimensions = width && height ? { width, height } : undefined;
				this.dimensions = dimensions;
				this.phase = 'uploading';
				this.publish();

				if (this.mimeType.startsWith('image/') && (width === undefined || height === undefined)) {
					const measured = await this.measureImage(blob);
					if (!this.isCurrent(generation)) return { status: 'invalidated' };
					if (measured.width > 0 && measured.height > 0) dimensions = measured;
				}
			} else if (
				this.shouldMeasureImage &&
				this.mimeType.startsWith('image/') &&
				dimensions === undefined
			) {
				const measured = await this.measureImage(blob);
				if (!this.isCurrent(generation)) return { status: 'invalidated' };
				if (measured.width > 0 && measured.height > 0) dimensions = measured;
			}

			if (!this.isCurrent(generation)) return { status: 'invalidated' };
			this.dimensions = dimensions;
			const payload: AttachmentTransferPayload = {
				blob,
				filename: this.name,
				mimeType: this.mimeType,
				dimensions,
				accessKey: this.accessKey
			};
			this.retryPayload = payload;
			this.sourceBlob = undefined;
			this.phase = 'uploading';
			this.progress = 0;
			this.publish();
			return await this.runAttempt(payload, generation);
		} catch (error) {
			if (!this.isCurrent(generation)) return { status: 'invalidated' };
			this.sourceBlob = undefined;
			this.retryPayload = undefined;
			this.setActive(false);
			return { status: 'preprocess-failed', error };
		}
	}

	/** Supersede any current attempt and retry the exact retained payload. */
	async retry(): Promise<AttachmentTransferResult> {
		const payload = this.retryPayload;
		if (this.disposed || !payload) return { status: 'unavailable' };

		const generation = this.claimGeneration();
		this.setActive(true);
		this.phase = 'uploading';
		this.progress = 0;
		this.result = {};
		this.publish();
		return await this.runAttempt(payload, generation);
	}

	/** Permanently invalidate preprocessing/attempts and release transfer-owned bytes. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.controller?.abort();
		this.controller = undefined;
		this.sourceBlob = undefined;
		this.retryPayload = undefined;
		this.setActive(false);
	}

	private claimGeneration(): number {
		this.generation += 1;
		this.controller?.abort();
		this.controller = undefined;
		return this.generation;
	}

	private isCurrent(generation: number): boolean {
		return !this.disposed && this.generation === generation;
	}

	private async runAttempt(
		payload: AttachmentTransferPayload,
		generation: number
	): Promise<AttachmentTransferResult> {
		const controller = new AbortController();
		this.controller = controller;

		try {
			const result = await this.upload(
				payload,
				(progress) => {
					if (!this.isCurrent(generation) || this.controller !== controller) return;
					this.progress = progress;
					this.publish();
				},
				controller.signal
			);

			if (!this.isCurrent(generation) || this.controller !== controller) {
				return { status: 'invalidated' };
			}
			this.retryPayload = undefined;
			this.phase = 'success';
			this.progress = 100;
			this.result = { fileId: result.fileId, url: result.url };
			this.publish();
			return { status: 'success' };
		} catch (error) {
			if (
				!this.isCurrent(generation) ||
				this.controller !== controller ||
				isAttachmentTransferAbort(error)
			) {
				return { status: 'invalidated' };
			}
			this.onAttemptError?.(error);
			this.phase = 'error';
			this.progress = 0;
			this.result = { error: error instanceof UploadError ? error.code : 'server' };
			this.publish();
			return { status: 'error' };
		} finally {
			if (this.isCurrent(generation) && this.controller === controller) {
				this.controller = undefined;
				this.setActive(false);
			}
		}
	}

	private publish(): void {
		this.onSnapshot({
			key: this.key,
			sourceName: this.sourceName,
			sourceSize: this.sourceSize,
			name: this.name,
			mimeType: this.mimeType,
			size: this.size,
			phase: this.phase,
			progress: this.progress,
			dimensions: this.dimensions,
			...this.result
		});
	}

	private setActive(active: boolean): void {
		if (this.active === active) return;
		this.active = active;
		this.onActivityChange?.(active);
	}
}
