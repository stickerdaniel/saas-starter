import { describe, it, expect, vi } from 'vitest';

import { resolveConvexToken } from './convex-jwt';

import type { RequestEvent } from '@sveltejs/kit';

// ---------------------------------------------------------------------------
// resolveConvexToken: the convex_jwt cookie dies with the JWT (15 min) while
// the Better Auth session cookie lives much longer. When only the session
// cookie survives, the token must be re-minted via the Better Auth token
// endpoint instead of treating the request as signed out.
// ---------------------------------------------------------------------------

/** Base64url-encodes a JWT with the given payload (signature is not verified). */
function fakeJwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

function fakeEvent(options: {
	url?: string;
	cookies?: Record<string, string>;
	tokenResponse?: { ok: boolean; token?: string } | Error;
}): {
	event: RequestEvent;
	fetch: ReturnType<typeof vi.fn>;
	setCookie: ReturnType<typeof vi.fn>;
} {
	const url = new URL(options.url ?? 'http://localhost:5173/en/app');
	const jar = options.cookies ?? {};
	const setCookie = vi.fn();
	const fetch = vi.fn(async () => {
		if (options.tokenResponse instanceof Error) throw options.tokenResponse;
		const { ok, token } = options.tokenResponse ?? { ok: false };
		return {
			ok,
			json: async () => ({ token })
		} as Response;
	});
	const event = {
		url,
		request: new Request(url),
		cookies: {
			get: (name: string) => jar[name],
			set: setCookie
		},
		fetch
	} as unknown as RequestEvent;
	return { event, fetch, setCookie };
}

describe('resolveConvexToken', () => {
	it('returns the JWT cookie when it is still alive, without fetching', async () => {
		const { event, fetch } = fakeEvent({
			cookies: { 'better-auth.convex_jwt': 'jwt-alive' }
		});
		await expect(resolveConvexToken(event)).resolves.toBe('jwt-alive');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('reads the __Secure- prefixed cookies on HTTPS origins', async () => {
		const { event, fetch } = fakeEvent({
			url: 'https://example.com/en/app',
			cookies: { '__Secure-better-auth.convex_jwt': 'jwt-secure' }
		});
		await expect(resolveConvexToken(event)).resolves.toBe('jwt-secure');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns undefined for signed-out requests, without fetching', async () => {
		const { event, fetch } = fakeEvent({ cookies: {} });
		await expect(resolveConvexToken(event)).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('re-mints the JWT from the session cookie when the JWT cookie is gone', async () => {
		const token = fakeJwt({ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 900 });
		const { event, fetch } = fakeEvent({
			cookies: { 'better-auth.session_token': 'session-alive' },
			tokenResponse: { ok: true, token }
		});
		await expect(resolveConvexToken(event)).resolves.toBe(token);
		expect(fetch).toHaveBeenCalledWith('/api/auth/convex/token', expect.anything());
	});

	it('mirrors the re-minted JWT as a cookie with maxAge from the exp claim', async () => {
		const exp = Math.floor(Date.now() / 1000) + 900;
		const token = fakeJwt({ sub: 'user_1', exp });
		const { event, setCookie } = fakeEvent({
			cookies: { 'better-auth.session_token': 'session-alive' },
			tokenResponse: { ok: true, token }
		});
		await resolveConvexToken(event);
		expect(setCookie).toHaveBeenCalledTimes(1);
		const [name, value, attributes] = setCookie.mock.calls[0]!;
		expect(name).toBe('better-auth.convex_jwt');
		expect(value).toBe(token);
		expect(attributes).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' });
		expect(attributes.maxAge).toBeGreaterThan(890);
		expect(attributes.maxAge).toBeLessThanOrEqual(900);
	});

	it('uses the __Secure- prefixed cookie names when minting on HTTPS', async () => {
		const token = fakeJwt({ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 900 });
		const { event, setCookie } = fakeEvent({
			url: 'https://example.com/en/app',
			cookies: { '__Secure-better-auth.session_token': 'session-alive' },
			tokenResponse: { ok: true, token }
		});
		await expect(resolveConvexToken(event)).resolves.toBe(token);
		expect(setCookie.mock.calls[0]![0]).toBe('__Secure-better-auth.convex_jwt');
		expect(setCookie.mock.calls[0]![2]).toMatchObject({ secure: true });
	});

	it('never mints on /api/auth requests (the token endpoint runs through this hook)', async () => {
		const { event, fetch } = fakeEvent({
			url: 'http://localhost:5173/api/auth/convex/token',
			cookies: { 'better-auth.session_token': 'session-alive' }
		});
		await expect(resolveConvexToken(event)).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('falls back to signed out when the token endpoint rejects (expired session)', async () => {
		const { event, setCookie } = fakeEvent({
			cookies: { 'better-auth.session_token': 'session-stale' },
			tokenResponse: { ok: false }
		});
		await expect(resolveConvexToken(event)).resolves.toBeUndefined();
		expect(setCookie).not.toHaveBeenCalled();
	});

	it('falls back to signed out when the token endpoint is unreachable', async () => {
		const { event, setCookie } = fakeEvent({
			cookies: { 'better-auth.session_token': 'session-alive' },
			tokenResponse: new Error('fetch failed')
		});
		await expect(resolveConvexToken(event)).resolves.toBeUndefined();
		expect(setCookie).not.toHaveBeenCalled();
	});

	it('falls back to signed out when the response carries no token', async () => {
		const { event, setCookie } = fakeEvent({
			cookies: { 'better-auth.session_token': 'session-alive' },
			tokenResponse: { ok: true }
		});
		await expect(resolveConvexToken(event)).resolves.toBeUndefined();
		expect(setCookie).not.toHaveBeenCalled();
	});
});
