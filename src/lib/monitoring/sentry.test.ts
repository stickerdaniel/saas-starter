// @vitest-environment node

import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type * as Sentry from '@sentry/sveltekit';
type SentryClient = NonNullable<ReturnType<typeof Sentry.getClient>>;
type SentryTransport = NonNullable<ReturnType<SentryClient['getTransport']>>;
type Envelope = Parameters<SentryTransport['send']>[0];

const { envelopes } = vi.hoisted(() => ({ envelopes: [] as Envelope[] }));

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$env/static/public', () => ({ PUBLIC_SENTRY_DSN: 'https://public@example.com/1' }));
vi.mock('@sentry/sveltekit', async (importOriginal) => {
	const sdk = await importOriginal<typeof Sentry>();
	return {
		...sdk,
		init: (options: Parameters<typeof sdk.init>[0]) =>
			sdk.init({
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

import { loadSentry } from './sentry';

afterEach(async () => {
	await (await loadSentry())?.close();
});

it('keeps automatic request identity and source context out of emitted events', async () => {
	const sdk = await loadSentry();
	expect(sdk).not.toBeNull();
	sdk!.withScope((scope) => {
		scope.setSDKProcessingMetadata({
			normalizedRequest: {
				url: 'https://example.com/path?remote-user=private-query&page=2',
				method: 'GET',
				headers: {
					// Sentry redacts `session` values on its own; `theme` exercises the cookie policy.
					cookie: 'session=private-cookie; theme=private-theme',
					'x-forwarded-for': '203.0.113.42',
					'remote-user': 'private-user',
					'content-type': 'application/json'
				}
			},
			ipAddress: '203.0.113.42'
		});
		sdk!.captureMessage('A safe diagnostic');
		sdk!.captureEvent({
			exception: {
				values: [
					{
						type: 'Error',
						value: 'A safe exception',
						stacktrace: {
							frames: [{ filename: fileURLToPath(import.meta.url), lineno: 1, colno: 1 }]
						}
					}
				]
			}
		});
	});
	await sdk!.flush();

	const events = envelopes.flatMap(([, items]) =>
		items.filter(([header]) => header.type === 'event').map(([, payload]) => payload)
	);
	expect(events).toHaveLength(2);
	expect(events[0]).toMatchObject({
		message: 'A safe diagnostic',
		request: { method: 'GET', headers: { 'content-type': 'application/json' } }
	});
	const serialized = JSON.stringify(events[0]);
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
	expect(events[0]).not.toHaveProperty('exception');
	expect(events[1]).toMatchObject({ exception: { values: [{ value: 'A safe exception' }] } });
	const exception = events[1] as Sentry.Event;
	const frame = exception.exception?.values?.[0]?.stacktrace?.frames?.[0];
	expect(frame).toBeDefined();
	for (const field of ['pre_context', 'context_line', 'post_context']) {
		expect(frame).not.toHaveProperty(field);
	}
});
