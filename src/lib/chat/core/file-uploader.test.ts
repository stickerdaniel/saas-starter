/**
 * Unit tests for the upload transport layer.
 *
 * These pin the error vocabulary the UI depends on: every failure mode maps to
 * a stable UploadErrorCode, and a cancelation stays an AbortError DOMException
 * rather than becoming an UploadError, because callers outside the chat (the
 * avatar upload) distinguish the two.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { UploadError, uploadToStorage, uploadFileWithProgress } from './file-uploader.js';
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
