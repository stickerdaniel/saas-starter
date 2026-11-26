import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadFileWithProgress } from '../chat/core/file-uploader.js';
import { UploadError } from './transfer.js';
import { uploadToEndpoint } from './upload-endpoint.js';

const token = vi.hoisted(() => vi.fn());

vi.mock('$app/env/public', () => ({ PUBLIC_CONVEX_SITE_URL: 'https://site.test' }));
vi.mock('../auth-client.js', () => ({ authClient: { convex: { token } } }));

type Handler = () => void;

function fakeServer() {
	const handlers: Record<string, Handler> = {};
	const headers: Record<string, string> = {};
	const xhr = {
		status: 0,
		responseText: '',
		upload: { addEventListener: () => {} },
		addEventListener: (event: string, handler: Handler) => {
			handlers[event] = handler;
		},
		open: vi.fn(),
		setRequestHeader: (name: string, value: string) => {
			headers[name] = value;
		},
		abort: vi.fn(),
		send: vi.fn()
	};
	vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
		return xhr;
	});
	return {
		xhr,
		headers,
		respond: async (status: number, body: unknown) => {
			await vi.waitFor(() => expect(xhr.send).toHaveBeenCalled());
			xhr.status = status;
			xhr.responseText = JSON.stringify(body);
			handlers.load?.();
		}
	};
}

const prepared = new Blob(['webp bytes'], { type: 'image/webp' });

beforeEach(() => {
	token.mockResolvedValue({ data: { token: 'jwt-1' }, error: null });
});

afterEach(() => {
	vi.unstubAllGlobals();
	token.mockReset();
});

describe('the chat upload transport', () => {
	it('posts the prepared blob to the surface route with the JWT and the visitor id', async () => {
		const server = fakeServer();

		const pending = uploadFileWithProgress(
			prepared,
			'shot.webp',
			() => {},
			{ purpose: 'support', getVisitorArgs: () => ({ anonymousUserId: 'anon_1' }) },
			{ width: 4, height: 3 }
		);
		await server.respond(200, { fileId: 'file-1', url: 'https://cdn.test/1', isImage: true });

		await expect(pending).resolves.toEqual({ fileId: 'file-1', url: 'https://cdn.test/1' });
		expect(server.xhr.open).toHaveBeenCalledWith(
			'POST',
			'https://site.test/uploads/support?filename=shot.webp&width=4&height=3'
		);
		expect(server.xhr.send).toHaveBeenCalledWith(prepared);
		expect(server.headers).toEqual({
			'Content-Type': 'image/webp',
			Authorization: 'Bearer jwt-1',
			'X-Anonymous-User-Id': 'anon_1'
		});
	});

	it('sends no Authorization header without a session', async () => {
		token.mockResolvedValue({ data: null, error: { status: 401 } });
		const server = fakeServer();

		const pending = uploadFileWithProgress(prepared, 'shot.webp', () => {}, { purpose: 'aiChat' });
		await server.respond(401, { code: 'Unauthenticated' });

		await expect(pending).rejects.toMatchObject({
			code: 'server',
			providerCode: 'Unauthenticated'
		});
		expect(server.headers).toEqual({ 'Content-Type': 'image/webp' });
	});
});

describe('the profile image transport', () => {
	it('turns a refusal body into the code and retry delay the avatar reads', async () => {
		const server = fakeServer();

		const pending = uploadToEndpoint({
			purpose: 'profileImage',
			blob: prepared,
			decode: () => 'unused',
			onProgress: () => {}
		});
		await server.respond(429, { code: 'RATE_LIMITED', retryAfter: 1_250 });

		const error = await pending.catch((reason: unknown) => reason);
		expect(error).toBeInstanceOf(UploadError);
		expect(error).toMatchObject({
			code: 'server',
			providerCode: 'RATE_LIMITED',
			retryAfterMs: 1_250
		});
		expect(server.xhr.open).toHaveBeenCalledWith('POST', 'https://site.test/uploads/profileImage');
	});
});
