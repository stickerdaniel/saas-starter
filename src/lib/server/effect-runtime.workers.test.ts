// @vitest-environment node
import path from 'node:path';
import { build } from 'esbuild';
import * as Schema from 'effect/Schema';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const encode = (value: Record<string, unknown>) =>
	Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${encode({ alg: 'RS256' })}.${encode({ sub: 'user_1', exp: 4_102_444_800 })}.signature`;

const decodeMinted = Schema.decodeUnknownSync(
	Schema.Struct({ token: Schema.NullOr(Schema.String), written: Schema.Array(Schema.String) })
);

async function upstream(request: Request): Promise<Response> {
	const mode = new URL(request.url).searchParams.get('mode');
	if (mode === 'stall-headers') return new Promise<Response>(() => {});
	if (mode === 'stall-body') {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"token":'));
			}
		});
		return new Response(body, { headers: { 'content-type': 'application/json' } });
	}
	if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1_000));
	return Response.json({ token: TOKEN });
}

let worker: Miniflare;

async function mint(mode: string, init: { signal?: AbortSignal } = {}) {
	const startedAt = performance.now();
	const response = await worker.dispatchFetch(`http://app.test/en/app?mode=${mode}`, init);
	const body = await response.text();
	expect({ status: response.status, body: response.status === 200 ? '' : body }).toEqual({
		status: 200,
		body: ''
	});
	const minted = decodeMinted(JSON.parse(body));
	return { ...minted, elapsed: performance.now() - startedAt };
}

beforeAll(async () => {
	const bundle = await build({
		entryPoints: [path.join(import.meta.dirname, 'test-fixtures/mint-worker.ts')],
		bundle: true,
		format: 'esm',
		platform: 'browser',
		conditions: ['workerd', 'worker'],
		target: 'es2022',
		write: false
	});
	const [script] = bundle.outputFiles;
	if (!script) throw new Error('esbuild produced no Worker script');
	worker = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script: script.text,
			compatibilityDate: '2026-03-31',
			compatibilityFlags: ['nodejs_compat'],
			serviceBindings: { UPSTREAM: upstream }
		})
	);
	await worker.ready;
}, 60_000);

afterAll(async () => {
	await worker?.dispose();
});

describe('the token mint on Workers', () => {
	it('answers 20 concurrent mints, each stalled one at its own deadline', async () => {
		const modes = [
			...Array.from({ length: 10 }, () => 'healthy'),
			...Array.from({ length: 5 }, () => 'stall-headers'),
			...Array.from({ length: 5 }, () => 'stall-body')
		];
		const startedAt = performance.now();

		const results = await Promise.all(modes.map((mode) => mint(mode)));

		expect(performance.now() - startedAt).toBeLessThan(7_500);
		for (const [index, mode] of modes.entries()) {
			const result = results[index];
			if (mode === 'healthy') {
				expect(result).toMatchObject({ token: TOKEN, written: ['better-auth.convex_jwt'] });
				expect(result?.elapsed).toBeLessThan(2_000);
			} else {
				expect(result).toMatchObject({ token: null, written: [] });
				expect(result?.elapsed).toBeGreaterThanOrEqual(4_900);
			}
		}
	}, 30_000);

	it('keeps answering after a client cancels a mint', async () => {
		await expect(mint('slow', { signal: AbortSignal.timeout(100) })).rejects.toThrow();

		const followUp = await mint('healthy');
		expect(followUp).toMatchObject({ token: TOKEN });
		expect(followUp.elapsed).toBeLessThan(1_000);

		await new Promise((resolve) => setTimeout(resolve, 1_200));
		await expect(mint('healthy')).resolves.toMatchObject({ token: TOKEN });
	}, 30_000);
});
