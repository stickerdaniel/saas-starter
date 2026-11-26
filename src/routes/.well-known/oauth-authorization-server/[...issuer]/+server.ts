import { error } from '@sveltejs/kit';
import { PUBLIC_CONVEX_SITE_URL } from '$app/env/public';
import type { RequestHandler } from './$types';

const ISSUER_PATH = 'api/auth';
const FORWARDED_HEADERS = ['Content-Type', 'Cache-Control', 'Access-Control-Allow-Origin'];

export const GET: RequestHandler = async ({ params, fetch }) => {
	if (params.issuer !== ISSUER_PATH) error(404);
	const upstream = await fetch(
		`${PUBLIC_CONVEX_SITE_URL}/.well-known/oauth-authorization-server/${ISSUER_PATH}`
	);
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return new Response(upstream.body, { status: upstream.status, headers });
};
