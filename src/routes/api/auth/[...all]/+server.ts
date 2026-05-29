import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from '@sveltejs/kit';

const { GET: rawGet, POST: rawPost } = createSvelteKitHandler();

function normalizeResponse(response: Response): Response {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers)
	});
}

function isAbortError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === 'AbortError') return true;
	const cause = (err as { cause?: unknown }).cause;
	return cause instanceof Error && cause.name === 'AbortError';
}

async function safeProxy(
	handler: RequestHandler,
	event: Parameters<RequestHandler>[0]
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

export const GET: RequestHandler = (event) => safeProxy(rawGet, event);
export const POST: RequestHandler = (event) => safeProxy(rawPost, event);
