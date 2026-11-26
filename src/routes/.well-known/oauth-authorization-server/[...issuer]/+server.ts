import { PUBLIC_CONVEX_SITE_URL } from '$app/env/public';
import type { RequestHandler } from './$types';

const FORWARDED_HEADERS = ['Content-Type', 'Cache-Control', 'Access-Control-Allow-Origin'];

export const GET: RequestHandler = async ({ params, fetch }) => {
	const upstream = await fetch(
		`${PUBLIC_CONVEX_SITE_URL}/.well-known/oauth-authorization-server/${params.issuer}`
	);
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return new Response(upstream.body, { status: upstream.status, headers });
};
