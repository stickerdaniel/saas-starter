import type { RequestEvent, RequestHandler } from '@sveltejs/kit';

/**
 * Recognises a fetch/undici AbortError, including when it is wrapped as the
 * `cause` of another error (e.g. a `TypeError: fetch failed`).
 */
export function isAbortError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === 'AbortError') return true;
	const cause = (err as { cause?: unknown }).cause;
	return cause instanceof Error && cause.name === 'AbortError';
}

/** Rebuild the response so SvelteKit receives mutable headers it can stream. */
function normalizeResponse(response: Response): Response {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers)
	});
}

/**
 * Forwards an auth request through the Better Auth handler. A client abort
 * (page navigation, unload, query cleanup) propagates to the upstream fetch as
 * an AbortError; converting it to a 499 (Client Closed Request) stops it from
 * bubbling up as an unhandled 500 and polluting logs / Sentry. Genuine upstream
 * failures are logged with request context and rethrown so they still surface.
 */
export async function proxyAuthRequest(
	handler: RequestHandler,
	event: RequestEvent
): Promise<Response> {
	try {
		return normalizeResponse(await handler(event));
	} catch (err) {
		if (isAbortError(err) || event.request.signal.aborted) {
			return new Response(null, { status: 499 });
		}
		console.error('[auth-proxy]', event.request.method, new URL(event.request.url).pathname, err);
		throw err;
	}
}
