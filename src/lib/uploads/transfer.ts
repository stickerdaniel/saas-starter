/**
 * Surface-neutral upload primitives.
 *
 * This module owns the browser transport, progress/cancelation semantics, and
 * one stable error vocabulary. Chat collection policy, persistence, retry UI,
 * and storage lifetime deliberately do not belong here.
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

export function isUploadAbort(error: unknown): error is DOMException {
	return error instanceof DOMException && error.name === 'AbortError';
}

export type UploadBlobOptions<T> = {
	url: string;
	blob: Blob;
	/** Extra request headers. A Content-Type here replaces the blob's own type. */
	headers?: Readonly<Record<string, string>>;
	/**
	 * Turn the parsed JSON body of a 2xx response into the caller's result.
	 * Throwing rejects the upload as `parse`; a thrown UploadError is kept.
	 */
	decode: (body: unknown) => T;
	onProgress: UploadProgressCallback;
	signal?: AbortSignal;
};

function refusalOf(responseText: string, status: number): UploadError {
	let body: unknown;
	try {
		body = JSON.parse(responseText);
	} catch {
		return new UploadError('http', status);
	}
	const fields = typeof body === 'object' && body !== null ? body : {};
	const code = 'code' in fields ? fields.code : undefined;
	if (typeof code !== 'string') return new UploadError('http', status);
	const retryAfter = 'retryAfter' in fields ? fields.retryAfter : undefined;
	return new UploadError('server', undefined, {
		providerCode: code,
		retryAfterMs:
			typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : undefined
	});
}

/**
 * POST a blob with progress and AbortSignal support, then decode the response.
 *
 * Storage-neutral: any endpoint which takes the raw bytes and answers with
 * JSON can use it, whatever its authorization header and response shape. A
 * refused status whose JSON body names a `code` rejects as `server` with that
 * code and its `retryAfter`; any other refused status rejects as `http`.
 */
export function uploadBlobWithProgress<T>(options: UploadBlobOptions<T>): Promise<T> {
	const { url, blob, headers, decode, onProgress, signal } = options;
	return new Promise<T>((resolve, reject) => {
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
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(refusalOf(xhr.responseText, xhr.status));
				return;
			}

			let body: unknown;
			try {
				body = JSON.parse(xhr.responseText);
			} catch (error) {
				reject(new UploadError('parse', undefined, { cause: error }));
				return;
			}
			try {
				resolve(decode(body));
			} catch (error) {
				reject(
					error instanceof UploadError
						? error
						: new UploadError('parse', undefined, { cause: error })
				);
			}
		});

		xhr.addEventListener('error', () => reject(new UploadError('network')));
		xhr.addEventListener('abort', () => reject(new DOMException('Upload canceled', 'AbortError')));

		xhr.open('POST', url);
		const extra = Object.entries(headers ?? {});
		// XHR joins repeated headers into one list, so a caller's own type replaces the default.
		if (!extra.some(([name]) => name.toLowerCase() === 'content-type')) {
			xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
		}
		for (const [name, value] of extra) xhr.setRequestHeader(name, value);
		xhr.send(blob);
	});
}
