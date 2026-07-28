/**
 * File upload utilities
 *
 * Handles file uploads to Convex storage with progress tracking.
 */

import type { ConvexClient } from 'convex/browser';

/**
 * Result from a successful file upload
 */
export interface UploadResult {
	fileId: string;
	url: string;
	storageId: string;
}

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: number) => void;

/**
 * What went wrong during an upload, independent of how it is phrased to the
 * user. The transport layer has no access to translations, so it reports a code
 * and the UI picks the message.
 *
 * `network` / `http` / `parse` come from the storage POST itself. `server`
 * covers the Convex stages around it (presign, commit), which fail for reasons
 * the browser cannot inspect. All four are worth retrying; the transfer is the
 * only thing that went wrong.
 */
export type UploadErrorCode = 'network' | 'http' | 'parse' | 'server';

const UPLOAD_ERROR_MESSAGE: Record<UploadErrorCode, string> = {
	network: 'Network error during upload',
	http: 'Upload rejected by storage',
	parse: 'Malformed upload response',
	server: 'Upload could not be registered'
};

/**
 * An upload failure with a machine-readable cause.
 *
 * `message` stays English on purpose: it is developer-facing (logs, stack
 * traces). Anything shown to a user must be derived from `code` so it can be
 * translated. Two things are deliberately NOT UploadErrors:
 * cancelation stays the web-standard `DOMException` named `AbortError`, and
 * client-side validation failures (e.g. an image that will not compress under
 * the size cap) keep throwing their own already-translated Error, because they
 * are not retryable and the caller phrases them better than a generic code can.
 */
export class UploadError extends Error {
	readonly code: UploadErrorCode;
	/** HTTP status, present only for `code === 'http'`. */
	readonly status?: number;
	/**
	 * The underlying failure, for logs. Declared here rather than relying on
	 * `Error.cause`, which the lib version the Convex build targets does not
	 * know about.
	 */
	readonly cause?: unknown;

	constructor(code: UploadErrorCode, status?: number, options?: { cause?: unknown }) {
		super(UPLOAD_ERROR_MESSAGE[code]);
		this.name = 'UploadError';
		this.code = code;
		this.status = status;
		this.cause = options?.cause;
	}
}

/**
 * Run a Convex call, reporting any rejection as a `server` upload failure.
 * An abort passes through untouched so cancelation stays distinguishable.
 */
async function asServerFailure<T>(call: Promise<T>): Promise<T> {
	try {
		return await call;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new UploadError('server', undefined, { cause: error });
	}
}

/**
 * Upload a file to Convex storage with progress tracking
 *
 * This function handles the complete upload flow:
 * 1. Generate upload URL from Convex
 * 2. Upload file directly to storage with progress events
 * 3. Register file with agent component
 *
 * @param client - Convex client instance
 * @param file - File or Blob to upload
 * @param filename - Name for the uploaded file
 * @param onProgress - Callback for progress updates (0-100)
 * @param api - Convex API endpoints for file operations
 * @param dimensions - Optional image dimensions for storage
 * @param accessKey - Optional access key for file control
 * @param signal - Aborts the transfer; rejects with an `AbortError` DOMException
 * @returns Object containing fileId and url
 */
export async function uploadFileWithProgress(
	client: ConvexClient,
	file: File | Blob,
	filename: string,
	onProgress: ProgressCallback,
	api: {
		generateUploadUrl: Parameters<ConvexClient['mutation']>[0];
		saveUploadedFile: Parameters<ConvexClient['action']>[0];
		locale?: string;
		/** Provider for extra args to pass to generateUploadUrl (e.g., anonymousUserId for rate limiting) */
		getGenerateUploadUrlArgs?: () => Record<string, unknown>;
	},
	dimensions?: { width: number; height: number },
	accessKey?: string,
	signal?: AbortSignal
): Promise<UploadResult> {
	// 1. Generate upload URL (with optional extra args for rate limiting)
	const uploadUrlArgs = api.getGenerateUploadUrlArgs?.() ?? {};
	// The Convex stages are wrapped so callers get one error vocabulary for the
	// whole upload. Their raw messages are English server strings (rate limits,
	// download-URL failures) that must not reach the UI; `cause` keeps them for
	// logs.
	const { uploadUrl, uploadToken } = await asServerFailure(
		client.mutation(api.generateUploadUrl, uploadUrlArgs)
	);

	// 2. Upload file with progress tracking
	const storageId = await uploadToStorage(uploadUrl, file, onProgress, signal);

	// Cancelation between the transfer and the commit must not register the
	// file: the caller has already discarded the attachment, so a committed
	// record would have nothing referencing it. This is the last cancelable
	// point — once the action below is in flight it runs to completion.
	if (signal?.aborted) throw new DOMException('Upload canceled', 'AbortError');

	// 3. Register file with agent component (including dimensions for images)
	const result = await asServerFailure(
		client.action(api.saveUploadedFile, {
			storageId,
			uploadToken,
			filename,
			mimeType: file.type,
			locale: api.locale,
			accessKey,
			width: dimensions?.width,
			height: dimensions?.height
		})
	);

	// Ensure progress is 100% after completion
	onProgress(100);

	return {
		fileId: result.fileId,
		url: result.url,
		storageId
	};
}

/**
 * Upload file to storage URL with progress tracking via XHR
 *
 * Exported for upload flows that presign/commit through their own mutations
 * (e.g. profile images or app-specific file surfaces) but still want
 * progress events and cancelation.
 */
export async function uploadToStorage(
	uploadUrl: string,
	file: File | Blob,
	onProgress: ProgressCallback,
	signal?: AbortSignal
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		if (signal) {
			if (signal.aborted) {
				reject(new DOMException('Upload canceled', 'AbortError'));
				return;
			}
			signal.addEventListener('abort', () => xhr.abort(), { once: true });
		}

		// Track upload progress
		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable) {
				const percent = (e.loaded / e.total) * 100;
				onProgress(percent);
			}
		});

		// Handle successful upload
		xhr.addEventListener('load', () => {
			if (xhr.status === 200) {
				try {
					const response = JSON.parse(xhr.responseText);
					// A 200 with a well-formed but storageId-less body used to resolve
					// with undefined, which only surfaced later as a confusing commit
					// failure. Treat it as the malformed response it is.
					if (typeof response?.storageId !== 'string' || response.storageId === '') {
						reject(new UploadError('parse'));
						return;
					}
					resolve(response.storageId);
				} catch {
					reject(new UploadError('parse'));
				}
			} else {
				reject(new UploadError('http', xhr.status));
			}
		});

		// Handle errors
		xhr.addEventListener('error', () => reject(new UploadError('network')));
		xhr.addEventListener('abort', () => reject(new DOMException('Upload canceled', 'AbortError')));

		// Start upload
		xhr.open('POST', uploadUrl);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.send(file);
	});
}
