import { CONVEX_INTERNAL_URL } from '$app/env/private';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

/**
 * Bound each query attempt through its last body byte so a stalled upstream
 * cannot keep SSR waiting indefinitely. Matches the JWT mint deadline;
 * existing loaders handle rejection through their normal fallbacks.
 */
const QUERY_TIMEOUT_MS = 5000;

/**
 * Apply this rendering deadline only to reads. Mutations and actions may
 * legitimately take longer and retain their existing timeout behavior.
 */
const QUERY_PATHS = ['/api/query', '/api/query_ts', '/api/query_at_ts'];

function isQueryRequest(input: RequestInfo | URL): boolean {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	const { pathname } = new URL(url);
	return QUERY_PATHS.some((path) => pathname.endsWith(path));
}

/**
 * Aborts each query attempt, including its response body, at the deadline
 * while keeping any caller signal. The library's transient-query retry wraps
 * this fetch and does not repeat the resulting TimeoutError, so a stalled
 * upstream costs one deadline rather than one per retry.
 */
const fetchWithQueryDeadline: typeof globalThis.fetch = (input, init) => {
	if (!isQueryRequest(input)) return fetch(input, init);
	const deadline = AbortSignal.timeout(QUERY_TIMEOUT_MS);
	const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
	return fetch(input, { ...init, signal });
};

export function createServerConvexHttpClient(args: { token?: string }) {
	return createConvexHttpClient({
		token: args.token,
		convexUrl: CONVEX_INTERNAL_URL || undefined,
		options: { fetch: fetchWithQueryDeadline }
	});
}
