// @vitest-environment node

import { afterAll, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { HandleServerError } from '@sveltejs/kit/hooks';
import type * as Sentry from '@sentry/sveltekit';
type SentryClient = NonNullable<ReturnType<typeof Sentry.getClient>>;
type SentryTransport = NonNullable<ReturnType<SentryClient['getTransport']>>;
type Envelope = Parameters<SentryTransport['send']>[0];

const { envelopes } = vi.hoisted(() => ({ envelopes: [] as Envelope[] }));

vi.mock('$app/env', () => ({ browser: false }));
vi.mock('$app/env/public', () => ({ PUBLIC_SENTRY_DSN: 'https://public@example.com/1' }));
// The server SDK as Cloudflare Workers resolve it: the `workerd` build
// (@sentry/sveltekit/build/esm/index.workerd.js) exports no `init`.
vi.mock('@sentry/sveltekit', async (importOriginal) => {
	const { init: _absentOnWorkers, ...sdk } = await importOriginal<typeof Sentry>();
	return {
		...sdk,
		initCloudflareSentryHandle: (
			options: Parameters<typeof sdk.initCloudflareSentryHandle>[0]
		): ReturnType<typeof sdk.initCloudflareSentryHandle> =>
			sdk.initCloudflareSentryHandle({
				...options,
				// Exercise the real request-data processor without instrumenting the test runner.
				defaultIntegrations: [sdk.requestDataIntegration(), sdk.contextLinesIntegration()],
				transport: () => ({
					send: async (envelope: Envelope) => {
						envelopes.push(envelope);
						return { statusCode: 200 };
					},
					flush: async () => true
				})
			})
	};
});

import { loadSentry, loadSentryHandle } from './sentry';

afterAll(async () => {
	await (await loadSentry())?.close();
});

it('reports a server error without request identity or source context', async () => {
	const handle = await loadSentryHandle();
	const sdk = await loadSentry();
	expect(handle).not.toBeNull();
	expect(sdk).not.toBeNull();
	const handleError = sdk!.handleErrorWithSentry<HandleServerError>();

	const url = 'https://example.com/path?remote-user=private-query&page=2';
	const event = {
		request: new Request(url, {
			headers: {
				// Sentry redacts `session` values on its own; `theme` exercises the cookie policy.
				cookie: 'session=private-cookie; theme=private-theme',
				'x-forwarded-for': '203.0.113.42',
				'remote-user': 'private-user',
				'content-type': 'application/json'
			}
		}),
		url: new URL(url),
		route: { id: '/path' },
		locals: {},
		isSubRequest: false
	} as unknown as RequestEvent;

	await handle!({
		event,
		resolve: async () => {
			sdk!.getIsolationScope().setSDKProcessingMetadata({ ipAddress: '203.0.113.42' });
			await handleError({ kind: 'unknown', error: new Error('A safe exception'), event });
			return new Response('Internal Error', { status: 500 });
		}
	});
	await sdk!.flush();

	const events = envelopes.flatMap(([, items]) =>
		items
			.filter(([header]) => header.type === 'event')
			.map(([, payload]) => payload as Sentry.Event)
	);
	expect(events).toHaveLength(1);
	const [reported] = events;
	expect(reported).toMatchObject({
		exception: { values: [{ value: 'A safe exception' }] },
		request: { method: 'GET', headers: { 'content-type': 'application/json' } }
	});
	const serialized = JSON.stringify(reported);
	for (const sensitive of [
		'private-query',
		'private-cookie',
		'private-theme',
		'private-user',
		'203.0.113.42'
	]) {
		expect(serialized).not.toContain(sensitive);
	}
	expect(serialized).toContain('page=2');
	const frames = reported!.exception?.values?.[0]?.stacktrace?.frames ?? [];
	expect(frames.some((frame) => frame.filename?.endsWith('sentry.test.ts'))).toBe(true);
	for (const frame of frames) {
		for (const field of ['pre_context', 'context_line', 'post_context']) {
			expect(frame).not.toHaveProperty(field);
		}
	}
});
