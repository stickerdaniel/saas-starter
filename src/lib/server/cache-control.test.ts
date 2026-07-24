import { describe, expect, it } from 'vitest';
import { applyCacheControl } from './cache-control';

/**
 * Response-level tests for the document Cache-Control policy (see
 * scripts/AGENTS.md — a security header needs a hook plus a response test).
 * The invariant under guard: authenticated HTML must leave the origin with an
 * explicit `private` policy, because a header-less response lets a downstream
 * proxy fallback (Caddy/nginx on self-hosted forks) make it shared-cacheable.
 */

type EventInit = { path?: string; token?: string | null; routeId?: string | null };

function makeEvent({ path = '/en/app', token = null, routeId = null }: EventInit) {
	return {
		url: new URL(`https://example.com${path}`),
		locals: { token },
		route: { id: routeId }
	};
}

function htmlResponse(headers: Record<string, string> = {}, status = 200): Response {
	return new Response('<!doctype html>', {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
	});
}

describe('applyCacheControl', () => {
	it('marks authenticated HTML private when no policy exists', () => {
		const response = htmlResponse();
		applyCacheControl(makeEvent({ token: 'jwt', path: '/en/app' }), response);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('keeps a stricter route-owned policy, regardless of header casing', () => {
		const response = htmlResponse({ 'Cache-Control': 'no-store' });
		applyCacheControl(makeEvent({ token: 'jwt' }), response);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('leaves authenticated non-HTML responses untouched', () => {
		const response = new Response('{}', {
			headers: { 'content-type': 'application/json' }
		});
		applyCacheControl(makeEvent({ token: 'jwt' }), response);
		expect(response.headers.has('cache-control')).toBe(false);
	});

	it('leaves unauthenticated non-marketing HTML untouched', () => {
		const response = htmlResponse();
		applyCacheControl(makeEvent({ path: '/en/app', routeId: '/[[lang]]/app' }), response);
		expect(response.headers.has('cache-control')).toBe(false);
	});

	it('keeps unauthenticated marketing HTML publicly revalidatable', () => {
		const response = htmlResponse();
		applyCacheControl(makeEvent({ path: '/en' }), response);
		expect(response.headers.get('cache-control')).toBe('public, no-cache');
		expect(response.headers.get('vary')).toBe('Accept');
	});

	it('keeps unauthenticated auth-group HTML publicly revalidatable', () => {
		const response = htmlResponse();
		applyCacheControl(
			makeEvent({ path: '/en/signin', routeId: '/[[lang]]/(auth)/signin' }),
			response
		);
		expect(response.headers.get('cache-control')).toBe('public, no-cache');
	});

	it('never marks a token-carrying request public, even on marketing paths', () => {
		// A signed-in user browsing the landing page still gets the personalized
		// SSR document (header shows their account), so it must not enter shared
		// caches.
		const response = htmlResponse();
		applyCacheControl(makeEvent({ path: '/en', token: 'jwt' }), response);
		expect(response.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('never emits a freshness lifetime on any document', () => {
		// Document shells reference content-hashed chunks, and the deploy
		// recovery only covers the running app — SvelteKit has no hook for a
		// stale shell whose initial entry import 404s. Revalidation on every
		// reuse is the only guard for that path, so no branch may ever grant a
		// max-age/s-maxage window during which a cached shell can outlive its
		// chunk set.
		const cases: EventInit[] = [
			{ path: '/en' },
			{ path: '/en/signin', routeId: '/[[lang]]/(auth)/signin' },
			{ path: '/en/app', token: 'jwt' },
			{ path: '/en', token: 'jwt' }
		];
		for (const init of cases) {
			const response = htmlResponse();
			applyCacheControl(makeEvent(init), response);
			expect(response.headers.get('cache-control') ?? '').not.toMatch(/max-age/i);
		}
	});
});
