// @vitest-environment node
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import * as Schema from 'effect/Schema';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const VIEWER = { _id: 'user_1', name: 'Ada' };
const MESSAGES = [{ _id: 'message_1', body: 'hello' }];

const decodeChat = Schema.decodeUnknownSync(
	Schema.Struct({
		viewer: Schema.NullOr(Schema.Struct({ _id: Schema.String, name: Schema.String })),
		messages: Schema.Array(Schema.Struct({ _id: Schema.String, body: Schema.String }))
	})
);

const STUBS: Record<string, string> = {
	'$app/env':
		'export const dev = false; export const browser = false; export const building = false; export const version = "test";',
	'$app/env/private': 'export const CONVEX_INTERNAL_URL = "http://convex.test";',
	'$app/env/public': 'export const PUBLIC_CONVEX_URL = "http://convex.test";',
	'$app/paths': 'export const base = ""; export const assets = "";',
	'$app/state': 'export const page = {};',
	'#lib/monitoring/sentry.js': 'export const loadedSentry = () => null;'
};

const stubs: Plugin = {
	name: 'sveltekit-stubs',
	setup(plugin) {
		plugin.onResolve(
			{
				filter: /^(\$app\/(env|env\/private|env\/public|paths|state)|#lib\/monitoring\/sentry\.js)$/
			},
			(args) => ({
				path: args.path,
				namespace: 'stub'
			})
		);
		plugin.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
			contents: STUBS[args.path],
			loader: 'js'
		}));
	}
};

async function convex(request: Request): Promise<Response> {
	const { path: name } = (await request.json()) as { path: string };
	const stalled = request.headers.get('authorization') === 'Bearer stall';
	if (name === 'messages:list' && stalled) return new Promise<Response>(() => {});
	const value = name === 'users:viewer' ? VIEWER : name === 'messages:list' ? MESSAGES : null;
	return Response.json({ status: 'success', value, logLines: [] });
}

let worker: Miniflare;

async function chat(token: string) {
	const startedAt = performance.now();
	const response = await worker.dispatchFetch(
		`http://app.test/en/app/community-chat?token=${token}`
	);
	const body = await response.text();
	expect({ status: response.status, body: response.status === 200 ? '' : body }).toEqual({
		status: 200,
		body: ''
	});
	return { ...decodeChat(JSON.parse(body)), elapsed: performance.now() - startedAt };
}

beforeAll(async () => {
	const bundle = await build({
		entryPoints: [path.join(import.meta.dirname, 'test-fixtures/load-worker.ts')],
		bundle: true,
		format: 'esm',
		platform: 'browser',
		conditions: ['workerd', 'worker'],
		target: 'es2022',
		write: false,
		logLevel: 'silent',
		external: ['node:*'],
		plugins: [stubs]
	});
	const [script] = bundle.outputFiles;
	if (!script) throw new Error('esbuild produced no Worker script');
	worker = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: script.text,
			compatibilityDate: '2026-03-31',
			compatibilityFlags: ['nodejs_compat'],
			outboundService: convex
		})
	);
	await worker.ready;
}, 60_000);

afterAll(async () => {
	await worker?.dispose();
});

describe('the community-chat load on Workers', () => {
	it('answers 20 concurrent loads, each stalled query at its own deadline', async () => {
		const tokens = [
			...Array.from({ length: 10 }, () => 'healthy'),
			...Array.from({ length: 10 }, () => 'stall')
		];
		const startedAt = performance.now();

		const results = await Promise.all(tokens.map((token) => chat(token)));

		expect(performance.now() - startedAt).toBeLessThan(7_500);
		for (const [index, token] of tokens.entries()) {
			const result = results[index];
			expect(result?.viewer).toEqual(VIEWER);
			if (token === 'healthy') {
				expect(result?.messages).toEqual(MESSAGES);
				expect(result?.elapsed).toBeLessThan(2_000);
			} else {
				expect(result?.messages).toEqual([]);
				expect(result?.elapsed).toBeGreaterThanOrEqual(4_900);
			}
		}
	}, 30_000);
});
