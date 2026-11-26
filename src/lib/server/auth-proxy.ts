import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

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

const decodeRedirectBody = Schema.decodeUnknownOption(
	Schema.Struct({ redirect: Schema.Literal(true), url: Schema.String })
);

async function navigationRedirect(request: Request, response: Response): Promise<Response> {
	if (request.headers.get('sec-fetch-mode') !== 'navigate' || response.status !== 200) {
		return response;
	}
	if (!response.headers.get('content-type')?.includes('application/json')) return response;
	const body = decodeRedirectBody(
		await response
			.clone()
			.json()
			.catch(() => null)
	);
	if (Option.isNone(body)) return response;
	const headers = new Headers(response.headers);
	headers.delete('content-type');
	headers.delete('content-length');
	headers.set('location', body.value.url);
	return new Response(null, { status: 302, headers });
}

/**
 * Forwards an auth request through the Better Auth handler. A client abort
 * (page navigation, unload, query cleanup) propagates to the upstream fetch as
 * an AbortError; converting it to a 499 (Client Closed Request) stops it from
 * bubbling up as an unhandled 500 and polluting logs / Sentry. Genuine upstream
 * failures are rethrown, so `handleError` logs and reports them. The concrete
 * path stays out of the log: it can hold a password-reset token.
 */
export async function proxyAuthRequest(
	handler: RequestHandler,
	event: RequestEvent
): Promise<Response> {
	try {
		return await navigationRedirect(event.request, normalizeResponse(await handler(event)));
	} catch (err) {
		if (isAbortError(err) || event.request.signal.aborted) {
			return new Response(null, { status: 499 });
		}
		throw err;
	}
}
