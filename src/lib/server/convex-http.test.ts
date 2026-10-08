// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeFunctionReference } from 'convex/server';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ CONVEX_INTERNAL_URL: '' }));
vi.mock('$app/env/private', () => ({
	get CONVEX_INTERNAL_URL() {
		return env.CONVEX_INTERNAL_URL;
	}
}));

import { load as signinLoad } from '../../routes/[[lang]]/(auth)/signin/+page.server';
import { createServerConvexHttpClient } from './convex-http';

// A real loopback upstream speaking the Convex HTTP protocol. The function name
// selects its behaviour; any other name never answers, like a stalled
// deployment. Tests observe the caller's result and whether the upstream
// request was closed.
const SLOW_WRITE_MS = 6000;
const attempts = new Map<string, number>();
const closed = new Map<string, Promise<void>>();

function answer(res: ServerResponse, value: string) {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ status: 'success', value, logLines: [] }));
}

const upstream = createServer((req, res) => {
	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		const name = (JSON.parse(body) as { path: string }).path;
		attempts.set(name, (attempts.get(name) ?? 0) + 1);
		closed.set(name, new Promise((resolve) => res.on('close', () => resolve())));
		if (name === 'test:healthy') return answer(res, 'fresh');
		if (name === 'test:slowWrite')
			return void setTimeout(() => answer(res, 'written'), SLOW_WRITE_MS);
		if (name === 'test:stalledBody') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.write('{"status":"success",');
		}
	});
});

beforeAll(async () => {
	await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
	env.CONVEX_INTERNAL_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
	upstream.closeAllConnections();
	await new Promise((resolve) => upstream.close(resolve));
});

describe.concurrent('createServerConvexHttpClient against a stalled upstream', () => {
	it('lets the sign-in load fall back and closes the stalled query', async ({ expect }) => {
		const startedAt = Date.now();
		await expect(signinLoad()).resolves.toEqual({
			oauthProviders: { google: false, github: false }
		});
		expect(Date.now() - startedAt).toBeLessThan(7000);
		await closed.get('auth:getAvailableOAuthProviders');
		expect(attempts.get('auth:getAvailableOAuthProviders')).toBe(1);
	}, 10_000);

	it('aborts a query whose response body never finishes', async ({ expect }) => {
		const client = createServerConvexHttpClient({});
		await expect(
			client.query(makeFunctionReference<'query'>('test:stalledBody'), {})
		).rejects.toMatchObject({ name: 'TimeoutError' });
		await closed.get('test:stalledBody');
	}, 10_000);

	it('returns a healthy query result', async ({ expect }) => {
		const client = createServerConvexHttpClient({});
		await expect(client.query(makeFunctionReference<'query'>('test:healthy'), {})).resolves.toBe(
			'fresh'
		);
	});

	it('lets a mutation run past the query deadline', async ({ expect }) => {
		const client = createServerConvexHttpClient({});
		await expect(
			client.mutation(makeFunctionReference<'mutation'>('test:slowWrite'), {})
		).resolves.toBe('written');
	}, 10_000);
});
