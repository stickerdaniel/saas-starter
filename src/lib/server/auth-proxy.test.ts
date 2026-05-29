// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { isAbortError, proxyAuthRequest } from './auth-proxy';

function makeEvent(signal?: AbortSignal): RequestEvent {
	return {
		request: new Request('http://localhost/api/auth/get-session', signal ? { signal } : undefined)
	} as RequestEvent;
}

describe('isAbortError', () => {
	it('detects a direct AbortError', () => {
		expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
	});

	it('detects an AbortError wrapped as a cause', () => {
		const err = new TypeError('fetch failed', { cause: new DOMException('aborted', 'AbortError') });
		expect(isAbortError(err)).toBe(true);
	});

	it('ignores unrelated errors and non-errors', () => {
		expect(isAbortError(new TypeError('connection refused'))).toBe(false);
		expect(isAbortError('aborted')).toBe(false);
		expect(isAbortError(undefined)).toBe(false);
	});
});

describe('proxyAuthRequest', () => {
	it('returns 499 when the handler throws an AbortError', async () => {
		const handler: RequestHandler = async () => {
			throw new DOMException('aborted', 'AbortError');
		};
		const res = await proxyAuthRequest(handler, makeEvent());
		expect(res.status).toBe(499);
	});

	it('returns 499 when the request signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const handler: RequestHandler = async () => {
			throw new Error('socket hang up');
		};
		const res = await proxyAuthRequest(handler, makeEvent(controller.signal));
		expect(res.status).toBe(499);
	});

	it('logs and rethrows genuine upstream failures', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const handler: RequestHandler = async () => {
			throw new TypeError('upstream exploded');
		};
		await expect(proxyAuthRequest(handler, makeEvent())).rejects.toThrow('upstream exploded');
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('passes a successful response through with rebuilt headers', async () => {
		const handler: RequestHandler = async () =>
			new Response('{"ok":true}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		const res = await proxyAuthRequest(handler, makeEvent());
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(await res.text()).toBe('{"ok":true}');
	});
});
