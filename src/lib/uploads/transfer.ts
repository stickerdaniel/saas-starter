/**
 * Surface-neutral upload primitives.
 *
 * A surface supplies only its provider-specific grant and commit calls. This
 * module owns the matching browser transport, progress/cancelation semantics,
 * and one stable error vocabulary. Chat collection policy, persistence, retry
 * UI, and storage lifetime deliberately do not belong here.
 */

export type UploadProgressCallback = (progress: number) => void;

/** Machine-readable failure cause; user-facing copy belongs to each surface. */
export type UploadErrorCode = 'network' | 'http' | 'parse' | 'server';

const UPLOAD_ERROR_MESSAGE: Record<UploadErrorCode, string> = {
	network: 'Network error during upload',
	http: 'Upload rejected by storage',
	parse: 'Malformed upload response',
	server: 'Upload could not be registered'
};

export type UploadErrorOptions = {
	cause?: unknown;
	/** Stable provider code transported in structured error data. */
	providerCode?: string;
	/** Provider retry delay, normalized to milliseconds. */
	retryAfterMs?: number;
};

/**
 * Upload failure with transport-independent metadata.
 *
 * The message remains developer-facing English. Surfaces branch on `code` and
 * `providerCode` to choose localized copy. Cancelation remains the web-standard
 * `DOMException` named `AbortError`, not an UploadError.
 */
export class UploadError extends Error {
	readonly code: UploadErrorCode;
	/** HTTP status, present only for `code === 'http'`. */
	readonly status?: number;
	readonly cause?: unknown;
	readonly providerCode?: string;
	readonly retryAfterMs?: number;

	constructor(code: UploadErrorCode, status?: number, options?: UploadErrorOptions) {
		super(UPLOAD_ERROR_MESSAGE[code]);
		this.name = 'UploadError';
		this.code = code;
		this.status = status;
		this.cause = options?.cause;
		this.providerCode = options?.providerCode;
		this.retryAfterMs = options?.retryAfterMs;
	}
}

export type UploadGrant = {
	uploadUrl: string;
	uploadToken: string;
};

export type UploadCommitInput = {
	storageId: string;
	uploadToken: string;
};

/** Provider-specific calls around the shared direct-to-storage transport. */
export type UploadAdapter<TResult> = {
	grant: () => Promise<UploadGrant>;
	commit: (input: UploadCommitInput) => Promise<TResult>;
};

export type UploadPreprocessResult = {
	blob: Blob;
	mimeType: string;
	filename?: string;
	width?: number;
	height?: number;
};

/** Surface-owned preparation behind a common, testable interface. */
export type UploadPreprocessor<TInput extends Blob = Blob> = (
	input: TInput
) => Promise<UploadPreprocessResult>;

export type GrantedUploadResult<TResult> = {
	storageId: string;
	value: TResult;
};

export function isUploadAbort(error: unknown): error is DOMException {
	return error instanceof DOMException && error.name === 'AbortError';
}

function abortIfRequested(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Upload canceled', 'AbortError');
}

type StructuredProviderData = Record<string, unknown>;

function isStructuredProviderData(data: unknown): data is StructuredProviderData {
	return data !== null && typeof data === 'object' && !Array.isArray(data);
}

function providerData(error: unknown): StructuredProviderData | undefined {
	if (error === null || typeof error !== 'object' || !('data' in error)) return undefined;
	const data = error.data;
	return isStructuredProviderData(data) ? data : undefined;
}

/**
 * Normalize a provider rejection without exposing provider prose to the UI.
 * Structured safe fields survive for localized surface-specific handling.
 */
export function normalizeUploadProviderError(error: unknown): Error {
	if (isUploadAbort(error) || error instanceof UploadError) return error;

	const data = providerData(error);
	const providerCode = typeof data?.code === 'string' ? data.code : undefined;
	const retryAfterMs =
		typeof data?.retryAfter === 'number' && Number.isFinite(data.retryAfter)
			? data.retryAfter
			: undefined;

	return new UploadError('server', undefined, {
		cause: error,
		providerCode,
		retryAfterMs
	});
}

async function callProvider<TResult>(call: () => Promise<TResult>): Promise<TResult> {
	try {
		return await call();
	} catch (error) {
		throw normalizeUploadProviderError(error);
	}
}

/** Request a provider grant with shared cancelation and error semantics. */
export async function requestUploadGrant<TResult>(
	adapter: UploadAdapter<TResult>,
	signal?: AbortSignal
): Promise<UploadGrant> {
	abortIfRequested(signal);
	const grant = await callProvider(adapter.grant);
	abortIfRequested(signal);
	return grant;
}

/**
 * Upload using an already-issued grant, then run the surface-specific commit.
 *
 * The signal is honored through the last safe point before commit. Once commit
 * starts, the provider call is allowed to finish because it cannot be canceled
 * reliably and may already have registered the blob.
 */
export async function uploadGrantedWithAdapter<TResult>(options: {
	adapter: UploadAdapter<TResult>;
	grant: UploadGrant;
	blob: Blob;
	onProgress: UploadProgressCallback;
	signal?: AbortSignal;
}): Promise<GrantedUploadResult<TResult>> {
	const { adapter, grant, blob, onProgress, signal } = options;
	abortIfRequested(signal);
	const storageId = await uploadToStorage(grant.uploadUrl, blob, onProgress, signal);
	abortIfRequested(signal);
	const value = await callProvider(() =>
		adapter.commit({ storageId, uploadToken: grant.uploadToken })
	);
	onProgress(100);
	return { storageId, value };
}

/** Complete grant, direct upload, and commit through one configured adapter. */
export async function uploadWithAdapter<TResult>(options: {
	adapter: UploadAdapter<TResult>;
	blob: Blob;
	onProgress: UploadProgressCallback;
	signal?: AbortSignal;
}): Promise<GrantedUploadResult<TResult>> {
	const grant = await requestUploadGrant(options.adapter, options.signal);
	return await uploadGrantedWithAdapter({ ...options, grant });
}

/** Upload a blob to a provider URL with progress and AbortSignal support. */
export async function uploadToStorage(
	uploadUrl: string,
	blob: Blob,
	onProgress: UploadProgressCallback,
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

		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
		});

		xhr.addEventListener('load', () => {
			if (xhr.status !== 200) {
				reject(new UploadError('http', xhr.status));
				return;
			}

			try {
				const response = JSON.parse(xhr.responseText);
				if (typeof response?.storageId !== 'string' || response.storageId === '') {
					reject(new UploadError('parse'));
					return;
				}
				resolve(response.storageId);
			} catch {
				reject(new UploadError('parse'));
			}
		});

		xhr.addEventListener('error', () => reject(new UploadError('network')));
		xhr.addEventListener('abort', () => reject(new DOMException('Upload canceled', 'AbortError')));

		xhr.open('POST', uploadUrl);
		xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
		xhr.send(blob);
	});
}
