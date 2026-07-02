/**
 * Server-side resolution of the Better Auth Convex JWT for SSR.
 *
 * The `convex_jwt` cookie expires together with the JWT itself (15 minutes by
 * default) while the Better Auth session cookie lives much longer. An idle tab
 * therefore makes authenticated requests without a JWT cookie, and treating
 * those as signed out bounces the user to /signin on full loads and returns
 * viewer-less root layout data on invalidated data requests. When the session
 * cookie is present but the JWT cookie is gone, a fresh JWT is minted from the
 * session via the Better Auth token endpoint instead.
 */

import { decodeJwtPayload } from './jwt';

import type { RequestEvent } from '@sveltejs/kit';

const JWT_COOKIE_BASE = 'better-auth.convex_jwt';
const SESSION_COOKIE_BASE = 'better-auth.session_token';
const TOKEN_ENDPOINT = '/api/auth/convex/token';
const MINT_TIMEOUT_MS = 5000;

/** Better Auth prefixes its cookies with `__Secure-` on HTTPS origins. */
function cookieName(base: string, isSecure: boolean): string {
	return isSecure ? `__Secure-${base}` : base;
}

/**
 * Resolve the Convex JWT for the current request: from the JWT cookie when it
 * is still alive, otherwise re-minted from the Better Auth session. Returns
 * undefined for signed-out requests and when minting fails, which is the same
 * signed-out path the caller took before.
 */
export async function resolveConvexToken(event: RequestEvent): Promise<string | undefined> {
	const isSecure = new URL(event.request.url).protocol === 'https:';
	const jwtCookie = event.cookies.get(cookieName(JWT_COOKIE_BASE, isSecure));
	if (jwtCookie) return jwtCookie;

	if (!event.cookies.get(cookieName(SESSION_COOKIE_BASE, isSecure))) return undefined;

	// The Better Auth routes run through this hook themselves; minting there
	// would recurse into the token endpoint.
	if (event.url.pathname.startsWith('/api/auth')) return undefined;

	return mintConvexToken(event, isSecure);
}

async function mintConvexToken(
	event: RequestEvent,
	isSecure: boolean
): Promise<string | undefined> {
	try {
		const response = await event.fetch(TOKEN_ENDPOINT, {
			signal: AbortSignal.timeout(MINT_TIMEOUT_MS)
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as { token?: unknown };
		const token = typeof body.token === 'string' && body.token !== '' ? body.token : undefined;
		if (!token) return undefined;

		// Mirror the cookie Better Auth would set so subsequent requests in the
		// same window skip the extra roundtrip. maxAge derives from the JWT's own
		// exp claim; without a readable exp the cookie lives for the browser
		// session, which is at most as long as Better Auth would allow.
		const exp = decodeJwtPayload(token)?.exp;
		const nowSeconds = Math.floor(Date.now() / 1000);
		const maxAge = typeof exp === 'number' ? Math.max(0, exp - nowSeconds) : undefined;
		event.cookies.set(cookieName(JWT_COOKIE_BASE, isSecure), token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: isSecure,
			...(maxAge !== undefined ? { maxAge } : {})
		});

		return token;
	} catch {
		// Transient failure (deploy window, timeout): fall back to the signed-out
		// path, which is what every such request hit unconditionally before.
		return undefined;
	}
}
