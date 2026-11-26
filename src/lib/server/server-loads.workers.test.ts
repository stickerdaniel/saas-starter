// @vitest-environment node
import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import * as Schema from 'effect/Schema';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const viewerOf = (token: string) => ({ _id: token, name: `User ${token}` });
const messagesOf = (token: string) => [{ _id: `message_${token}`, body: `hello ${token}` }];
const SLOW_MESSAGES_MS = 1_000;
const REQUEST_CONTEXT_REPORT =
	/cross-request|different request|another request|never generate a response|promise was created by a request|hung/i;

const workerdLogs: string[] = [];
class CaptureLog extends Log {
	override log(message: string) {
		workerdLogs.push(message);
	}
}

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
	const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
	if (name === 'messages:list' && token.startsWith('stall')) return new Promise<Response>(() => {});
	if (name === 'messages:list' && token.startsWith('slow')) {
		await new Promise((resolve) => setTimeout(resolve, SLOW_MESSAGES_MS));
	}
	const value =
		name === 'users:viewer' ? viewerOf(token) : name === 'messages:list' ? messagesOf(token) : null;
	return Response.json({ status: 'success', value, logLines: [] });
}

let worker: Miniflare;

async function chat(token: string, init: { signal?: AbortSignal } = {}) {
	const startedAt = performance.now();
	const response = await worker.dispatchFetch(
		`http://app.test/en/app/community-chat?token=${token}`,
		init
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
			outboundService: convex,
			log: new CaptureLog(LogLevel.VERBOSE),
			handleStructuredLogs: ({ message }) => {
				workerdLogs.push(message);
			}
		})
	);
	await worker.ready;
}, 60_000);

afterAll(async () => {
	await worker?.dispose();
});

describe('the community-chat load on Workers', () => {
	it('answers 20 concurrent loads for their own users, each stalled query at its own deadline', async () => {
		const tokens = [
			...Array.from({ length: 10 }, (_, index) => `user_${index}`),
			...Array.from({ length: 10 }, (_, index) => `stall_${index}`)
		];
		const startedAt = performance.now();

		const results = await Promise.all(tokens.map((token) => chat(token)));

		expect(performance.now() - startedAt).toBeLessThan(7_500);
		for (const [index, token] of tokens.entries()) {
			const result = results[index];
			expect(result?.viewer).toEqual(viewerOf(token));
			if (token.startsWith('user')) {
				expect(result?.messages).toEqual(messagesOf(token));
				expect(result?.elapsed).toBeLessThan(2_000);
			} else {
				expect(result?.messages).toEqual([]);
				expect(result?.elapsed).toBeGreaterThanOrEqual(4_900);
			}
		}
	}, 30_000);

	it('keeps answering for each user after a client cancels a load', async () => {
		await expect(chat('slow_cancelled', { signal: AbortSignal.timeout(100) })).rejects.toThrow();

		const followUp = await chat('user_after_cancel');
		expect(followUp).toMatchObject({
			viewer: viewerOf('user_after_cancel'),
			messages: messagesOf('user_after_cancel')
		});
		expect(followUp.elapsed).toBeLessThan(1_000);

		await new Promise((resolve) => setTimeout(resolve, SLOW_MESSAGES_MS + 200));
		await expect(chat('user_after_slow_finished')).resolves.toMatchObject({
			viewer: viewerOf('user_after_slow_finished')
		});
	}, 30_000);

	it('logs no request-context report from workerd', () => {
		expect(workerdLogs.filter((line) => REQUEST_CONTEXT_REPORT.test(line))).toEqual([]);
	});
});
