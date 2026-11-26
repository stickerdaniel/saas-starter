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

	it('rethrows a genuine upstream failure without logging its path', async () => {
		const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
			vi.spyOn(console, level).mockImplementation(() => {})
		);
		const failure = new TypeError('upstream exploded');
		const handler: RequestHandler = async () => {
			throw failure;
		};
		const event = {
			request: new Request('http://localhost/api/auth/reset-password/token-sentinel-4b1d')
		} as RequestEvent;

		await expect(proxyAuthRequest(handler, event)).rejects.toBe(failure);
		// handleError reports the rethrown failure with fixed fields.
		expect(consoles.flatMap((spy) => spy.mock.calls)).toEqual([]);
		for (const spy of consoles) spy.mockRestore();
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

	it('answers a browser navigation with a 302 when Better Auth returns its JSON redirect', async () => {
		const handler: RequestHandler = async () =>
			new Response('{"redirect":true,"url":"/signin?client_id=a"}', {
				status: 200,
				headers: { 'content-type': 'application/json', 'set-cookie': 'state=1; Path=/' }
			});
		const event = {
			request: new Request('http://localhost/api/auth/oauth2/authorize?client_id=a', {
				headers: { 'sec-fetch-mode': 'navigate' }
			})
		} as RequestEvent;
		const res = await proxyAuthRequest(handler, event);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/signin?client_id=a');
		expect(res.headers.get('set-cookie')).toBe('state=1; Path=/');
		expect(await res.text()).toBe('');
	});

	it('keeps the JSON redirect for a fetch from the page', async () => {
		const handler: RequestHandler = async () =>
			new Response('{"redirect":true,"url":"/oauth/consent"}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		const event = {
			request: new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'sec-fetch-mode': 'cors' }
			})
		} as RequestEvent;
		const res = await proxyAuthRequest(handler, event);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ redirect: true, url: '/oauth/consent' });
	});
});
