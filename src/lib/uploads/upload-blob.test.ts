/**
 * The storage-neutral blob transport behind both the direct storage upload and
 * a surface's own endpoint: request shape, response decoding, progress,
 * cancelation and the shared error vocabulary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadBlobWithProgress, uploadToStorage, UploadError } from './transfer.js';

type Handler = (event?: unknown) => void;

/** One scripted XMLHttpRequest; `respond` and friends play the server's part. */
function fakeServer() {
	const handlers: Record<string, Handler> = {};
	const uploadHandlers: Record<string, Handler> = {};
	const headers: Array<[string, string]> = [];
	const xhr = {
		status: 0,
		responseText: '',
		upload: {
			addEventListener: (event: string, handler: Handler) => {
				uploadHandlers[event] = handler;
			}
		},
		addEventListener: (event: string, handler: Handler) => {
			handlers[event] = handler;
		},
		open: vi.fn(),
		setRequestHeader: (name: string, value: string) => headers.push([name, value]),
		abort: vi.fn(() => handlers.abort?.()),
		send: vi.fn()
	};
	vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
		return xhr;
	});
	return {
		xhr,
		headers,
		progress: (loaded: number, total: number, lengthComputable = true) =>
			uploadHandlers.progress?.({ loaded, total, lengthComputable }),
		respond: (status: number, body: string) => {
			xhr.status = status;
			xhr.responseText = body;
			handlers.load?.();
		},
		dropConnection: () => handlers.error?.()
	};
}

const blob = new Blob(['payload'], { type: 'image/webp' });
const decodeGateway = (body: unknown) => {
	if (
		body === null ||
		typeof body !== 'object' ||
		!('ok' in body) ||
		body.ok !== true ||
		!('byteSize' in body) ||
		typeof body.byteSize !== 'number'
	) {
		throw new Error('unexpected gateway response');
	}
	return { byteSize: body.byteSize };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('uploadBlobWithProgress', () => {
	it('posts the bytes with caller headers and returns the decoded body', async () => {
		const server = fakeServer();

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/uploads/u-1',
			blob,
			headers: { Authorization: 'Bearer attempt-token' },
			decode: decodeGateway,
			onProgress: () => {}
		});
		server.respond(200, JSON.stringify({ ok: true, byteSize: blob.size }));

		await expect(pending).resolves.toEqual({ byteSize: blob.size });
		expect(server.xhr.open).toHaveBeenCalledWith('POST', 'https://gateway.test/uploads/u-1');
		expect(server.xhr.send).toHaveBeenCalledWith(blob);
		expect(server.headers).toEqual([
			['Content-Type', 'image/webp'],
			['Authorization', 'Bearer attempt-token']
		]);
	});

	it('lets a caller Content-Type replace the blob type instead of joining it', async () => {
		const server = fakeServer();

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			headers: { 'content-type': 'application/octet-stream' },
			decode: decodeGateway,
			onProgress: () => {}
		});
		server.respond(201, JSON.stringify({ ok: true, byteSize: 7 }));

		await expect(pending).resolves.toEqual({ byteSize: 7 });
		expect(server.headers).toEqual([['content-type', 'application/octet-stream']]);
	});

	it('reports computable progress as a percentage and ignores the rest', async () => {
		const server = fakeServer();
		const onProgress = vi.fn();

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress
		});
		server.progress(1, 4);
		server.progress(3, 0, false);
		server.progress(4, 4);
		server.respond(200, JSON.stringify({ ok: true, byteSize: 4 }));
		await pending;

		expect(onProgress.mock.calls).toEqual([[25], [100]]);
	});

	it.each([
		{ name: 'a body that is not JSON', body: '<html>proxy error</html>' },
		{ name: 'a success body of the wrong shape', body: JSON.stringify({ ok: false }) }
	])('rejects $name as parse and keeps the decoder cause', async ({ body }) => {
		const server = fakeServer();

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress: () => {}
		}).catch((error) => error);
		server.respond(200, body);
		const error = await pending;

		expect(error).toBeInstanceOf(UploadError);
		expect(error.code).toBe('parse');
		expect(error.cause).toBeInstanceOf(Error);
	});

	it('keeps an UploadError the decoder raised itself', async () => {
		const server = fakeServer();
		const own = new UploadError('server', undefined, { providerCode: 'QUOTA' });

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: () => {
				throw own;
			},
			onProgress: () => {}
		}).catch((error) => error);
		server.respond(200, '{}');

		await expect(pending).resolves.toBe(own);
	});

	it('keeps a dropped connection as network and a refused status as http', async () => {
		const dropped = fakeServer();
		const network = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress: () => {}
		}).catch((error) => error);
		dropped.dropConnection();
		expect(await network).toMatchObject({ name: 'UploadError', code: 'network' });

		const refused = fakeServer();
		const http = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress: () => {}
		}).catch((error) => error);
		refused.respond(401, JSON.stringify({ ok: true, byteSize: 1 }));
		expect(await http).toMatchObject({ name: 'UploadError', code: 'http', status: 401 });
	});

	it.each([201, 202])('decodes a %i answer from a custom endpoint', async (status) => {
		const server = fakeServer();

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress: () => {}
		});
		server.respond(status, JSON.stringify({ ok: true, byteSize: 7 }));

		await expect(pending).resolves.toEqual({ byteSize: 7 });
	});

	it('does not send once the signal is already aborted', async () => {
		const server = fakeServer();
		const controller = new AbortController();
		controller.abort();

		const error = await uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode: decodeGateway,
			onProgress: () => {},
			signal: controller.signal
		}).catch((value) => value);

		expect(error).toBeInstanceOf(DOMException);
		expect(error.name).toBe('AbortError');
		expect(server.xhr.send).not.toHaveBeenCalled();
	});

	it('aborts an upload in flight as AbortError and never decodes', async () => {
		const server = fakeServer();
		const controller = new AbortController();
		const decode = vi.fn(decodeGateway);

		const pending = uploadBlobWithProgress({
			url: 'https://gateway.test/raw',
			blob,
			decode,
			onProgress: () => {},
			signal: controller.signal
		}).catch((value) => value);
		server.progress(2, 7);
		controller.abort();
		const error = await pending;

		expect(server.xhr.abort).toHaveBeenCalledOnce();
		expect(error.name).toBe('AbortError');
		expect(error).not.toBeInstanceOf(UploadError);
		expect(decode).not.toHaveBeenCalled();
	});
});

describe('uploadToStorage on the shared transport', () => {
	it('still answers with the storage id and labels the blob type', async () => {
		const server = fakeServer();

		const pending = uploadToStorage('https://storage.test', blob, () => {});
		server.respond(200, JSON.stringify({ storageId: 'storage-9' }));

		await expect(pending).resolves.toBe('storage-9');
		expect(server.headers).toEqual([['Content-Type', 'image/webp']]);
	});

	it.each([
		{ status: 201, body: JSON.stringify({ storageId: 'storage-9' }) },
		{ status: 202, body: JSON.stringify({ storageId: 'storage-9' }) },
		{ status: 204, body: '' }
	])('refuses a $status answer as http, whatever its body', async ({ status, body }) => {
		const server = fakeServer();

		const pending = uploadToStorage('https://storage.test', blob, () => {}).catch((error) => error);
		server.respond(status, body);

		expect(await pending).toMatchObject({ name: 'UploadError', code: 'http', status });
	});
});
