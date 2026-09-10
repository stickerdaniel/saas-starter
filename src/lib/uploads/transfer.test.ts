/**
 * Unit tests for the shared upload transport and configured adapter boundary.
 *
 * These pin the stable error vocabulary, progress/cancelation semantics, and
 * provider metadata used by both chat attachments and profile images.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	requestUploadGrant,
	uploadGrantedWithAdapter,
	uploadToStorage,
	UploadError,
	type UploadAdapter
} from './transfer.js';
import { uploadFileWithProgress } from '../chat/core/file-uploader.js';
import type { ConvexClient } from 'convex/browser';

type XhrHandlers = Record<string, () => void>;

/**
 * Minimal XMLHttpRequest stand-in. `send` triggers the scripted outcome so a
 * test states only what the server did, not how XHR dispatches events.
 */
function stubXhr(outcome: {
	status?: number;
	responseText?: string;
	fail?: 'network';
	onSend?: (xhr: { abort: () => void }) => void;
}) {
	const handlers: XhrHandlers = {};
	const uploadHandlers: XhrHandlers = {};
	const abort = vi.fn(() => handlers.abort?.());

	const xhr = {
		status: outcome.status ?? 200,
		statusText: '',
		responseText: outcome.responseText ?? JSON.stringify({ storageId: 'storage-1' }),
		upload: {
			addEventListener: (event: string, handler: () => void) => {
				uploadHandlers[event] = handler;
			}
		},
		addEventListener: (event: string, handler: () => void) => {
			handlers[event] = handler;
		},
		open: vi.fn(),
		setRequestHeader: vi.fn(),
		abort,
		send: vi.fn(() => {
			if (outcome.onSend) {
				outcome.onSend(xhr);
				return;
			}
			if (outcome.fail === 'network') handlers.error?.();
			else handlers.load?.();
		})
	};

	// `new XMLHttpRequest()` needs a constructable stand-in, so this is a
	// function declaration returning the shared instance rather than an arrow.
	vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
		return xhr;
	});
	return { xhr, abort };
}

const noProgress = () => {};
const blob = new Blob(['payload'], { type: 'text/plain' });

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('uploadToStorage error codes', () => {
	it('reports a transport error as network', async () => {
		stubXhr({ fail: 'network' });

		const error = await uploadToStorage('https://storage.test', blob, noProgress).catch((e) => e);

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('network');
	});

	it('reports a rejected status as http and keeps the status', async () => {
		stubXhr({ status: 413 });

		const error = await uploadToStorage('https://storage.test', blob, noProgress).catch((e) => e);

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('http');
		expect(error.status).toBe(413);
	});

	it('reports unparseable output as parse', async () => {
		stubXhr({ responseText: 'not json' });

		const error = await uploadToStorage('https://storage.test', blob, noProgress).catch((e) => e);

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('parse');
	});

	it('treats a 200 without a storageId as parse, not success', async () => {
		// Regression: this used to resolve with undefined and only fail later,
		// during the commit, where the cause was no longer visible.
		stubXhr({ responseText: JSON.stringify({}) });

		const error = await uploadToStorage('https://storage.test', blob, noProgress).catch((e) => e);

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('parse');
	});

	it('resolves with the storage id on success', async () => {
		stubXhr({ responseText: JSON.stringify({ storageId: 'storage-42' }) });

		await expect(uploadToStorage('https://storage.test', blob, noProgress)).resolves.toBe(
			'storage-42'
		);
	});
});

describe('uploadToStorage cancelation', () => {
	it('aborts the request and rejects with AbortError, not UploadError', async () => {
		// The avatar upload distinguishes cancelation from failure by error type,
		// so this must not become an UploadError.
		const controller = new AbortController();
		const { abort } = stubXhr({ onSend: () => controller.abort() });

		const error = await uploadToStorage(
			'https://storage.test',
			blob,
			noProgress,
			controller.signal
		).catch((e) => e);

		expect(abort).toHaveBeenCalled();
		expect(error).toBeInstanceOf(DOMException);
		expect(error.name).toBe('AbortError');
		expect(error).not.toBeInstanceOf(UploadError);
	});

	it('rejects immediately when the signal is already aborted', async () => {
		stubXhr({});
		const controller = new AbortController();
		controller.abort();

		const error = await uploadToStorage(
			'https://storage.test',
			blob,
			noProgress,
			controller.signal
		).catch((e) => e);

		expect(error.name).toBe('AbortError');
	});
});

describe('configured upload adapter', () => {
	it('normalizes structured grant errors for surface-specific copy', async () => {
		const cause = { data: { code: 'RATE_LIMITED', retryAfter: 1_250 } };
		const adapter: UploadAdapter<string> = {
			grant: vi.fn(async () => {
				throw cause;
			}),
			commit: vi.fn(async () => 'unused')
		};

		const error = await requestUploadGrant(adapter).catch((value) => value);

		expect(error).toBeInstanceOf(UploadError);
		expect(error).toMatchObject({
			code: 'server',
			providerCode: 'RATE_LIMITED',
			retryAfterMs: 1_250,
			cause
		});
	});

	it('shares transport, progress, and exact grant/commit arguments', async () => {
		stubXhr({ responseText: JSON.stringify({ storageId: 'storage-77' }) });
		const progress = vi.fn();
		const commit = vi.fn(async () => 'https://cdn.test/avatar');
		const adapter: UploadAdapter<string> = {
			grant: vi.fn(async () => ({
				uploadUrl: 'https://storage.test',
				uploadToken: 'token-77'
			})),
			commit
		};

		await expect(
			uploadGrantedWithAdapter({
				adapter,
				grant: { uploadUrl: 'https://storage.test', uploadToken: 'token-77' },
				blob,
				onProgress: progress
			})
		).resolves.toEqual({ storageId: 'storage-77', value: 'https://cdn.test/avatar' });
		expect(commit).toHaveBeenCalledWith({
			storageId: 'storage-77',
			uploadToken: 'token-77'
		});
		expect(progress).toHaveBeenLastCalledWith(100);
	});

	it('normalizes structured commit errors through the same boundary', async () => {
		stubXhr({});
		const cause = { data: { code: 'FILE_TOO_LARGE' } };
		const adapter: UploadAdapter<string> = {
			grant: vi.fn(async () => ({
				uploadUrl: 'https://storage.test',
				uploadToken: 'token-1'
			})),
			commit: vi.fn(async () => {
				throw cause;
			})
		};

		const error = await uploadGrantedWithAdapter({
			adapter,
			grant: { uploadUrl: 'https://storage.test', uploadToken: 'token-1' },
			blob,
			onProgress: noProgress
		}).catch((value) => value);

		expect(error).toBeInstanceOf(UploadError);
		expect(error).toMatchObject({ code: 'server', providerCode: 'FILE_TOO_LARGE', cause });
	});

	it('does not request a grant when already canceled', async () => {
		const controller = new AbortController();
		controller.abort();
		const grant = vi.fn(async () => ({
			uploadUrl: 'https://storage.test',
			uploadToken: 'token-1'
		}));
		const adapter: UploadAdapter<string> = {
			grant,
			commit: vi.fn(async () => 'unused')
		};

		const error = await requestUploadGrant(adapter, controller.signal).catch((value) => value);

		expect(error).toBeInstanceOf(DOMException);
		expect(error.name).toBe('AbortError');
		expect(grant).not.toHaveBeenCalled();
	});
});

describe('uploadFileWithProgress', () => {
	const api = {
		generateUploadUrl: 'generateUploadUrl' as never,
		saveUploadedFile: 'saveUploadedFile' as never
	};

	function stubClient(overrides?: Partial<ConvexClient>): ConvexClient {
		return {
			mutation: vi.fn(async () => ({
				uploadUrl: 'https://storage.test',
				uploadToken: 'token-1'
			})),
			action: vi.fn(async () => ({ fileId: 'file-1', url: 'https://cdn.test/file-1' })),
			...overrides
		} as unknown as ConvexClient;
	}

	it('reports a failing presign as server', async () => {
		stubXhr({});
		const client = stubClient({
			mutation: vi.fn(async () => {
				throw new Error('Rate limit exceeded. Try again in 60 seconds.');
			}) as never
		});

		const error = await uploadFileWithProgress(client, blob, 'doc.txt', noProgress, api).catch(
			(e) => e
		);

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('server');
		// The raw English server text stays reachable for logs but never for the UI.
		expect((error.cause as Error).message).toContain('Rate limit');
	});

	it('reports a failing commit as server', async () => {
		stubXhr({});
		const client = stubClient({
			action: vi.fn(async () => {
				throw new Error('Failed to get download URL for uploaded file');
			}) as never
		});

		const error = await uploadFileWithProgress(client, blob, 'doc.txt', noProgress, api).catch(
			(e) => e
		);

		expect(error.code).toBe('server');
	});

	it('does not register the file when canceled after the transfer', async () => {
		// Cancelation cannot stop an action already in flight, so the guard has to
		// sit before it; otherwise removing an attachment mid-commit leaves a
		// stored file nothing references.
		const controller = new AbortController();
		stubXhr({ onSend: () => controller.abort() });
		const client = stubClient();

		const error = await uploadFileWithProgress(
			client,
			blob,
			'doc.txt',
			noProgress,
			api,
			undefined,
			undefined,
			controller.signal
		).catch((e) => e);

		expect(error.name).toBe('AbortError');
		expect(client.action).not.toHaveBeenCalled();
	});

	it('returns the committed file on success', async () => {
		stubXhr({});
		const client = stubClient();

		await expect(
			uploadFileWithProgress(client, blob, 'doc.txt', noProgress, api)
		).resolves.toMatchObject({ fileId: 'file-1', storageId: 'storage-1' });
	});
});
