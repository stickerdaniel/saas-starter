import type { RequestEvent } from '@sveltejs/kit';
import { resolveConvexToken } from '../convex-jwt';

interface Env {
	readonly UPSTREAM: { fetch: typeof fetch };
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const written: string[] = [];
		const event = {
			url,
			request,
			cookies: {
				get: (name: string) => (name === 'better-auth.session_token' ? 'session' : undefined),
				set: (name: string) => written.push(name)
			},
			fetch: (path: string, init?: RequestInit) =>
				env.UPSTREAM.fetch(`http://upstream${path}${url.search}`, init)
		} as unknown as RequestEvent;
		const token = await resolveConvexToken(event);
		return Response.json({ token: token ?? null, written });
	}
};
