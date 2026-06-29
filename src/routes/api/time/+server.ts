import type { RequestHandler } from './$types';

// Server wall-clock time, so the client can detect a misconfigured device clock.
// A skewed clock silently breaks cookie-based auth: a fast clock makes the
// browser treat freshly minted short-TTL auth cookies as already expired
// (RFC 6265), so the authenticated session never establishes and a reload can't
// fix it. Never cached — the value must reflect the moment of the request.
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response(JSON.stringify({ now: Date.now() }), {
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
