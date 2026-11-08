// @vitest-environment node

import { afterAll, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { HandleServerError } from '@sveltejs/kit/hooks';
import type * as Sentry from '@sentry/sveltekit';
type SentryClient = NonNullable<ReturnType<typeof Sentry.getClient>>;
type SentryTransport = NonNullable<ReturnType<SentryClient['getTransport']>>;
type Envelope = Parameters<SentryTransport['send']>[0];

const { envelopes, runtimeRelease } = vi.hoisted(() => {
	// A release the host environment could name. Only an explicit release keeps
	// events on the compiled build whatever the host sets.
	const runtimeRelease = process.env.SENTRY_RELEASE;
	process.env.SENTRY_RELEASE = 'host-environment-release';
	return { envelopes: [] as Envelope[], runtimeRelease };
});

// Outside dev, so a recovered failure writes the line whose id its event names.
vi.mock('$app/env', () => ({ browser: false, dev: false, version: 'compiled-build' }));
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

function reportedEvents(): Sentry.Event[] {
	return envelopes.flatMap(([, items]) =>
		items
			.filter(([header]) => header.type === 'event')
			.map(([, payload]) => payload as Sentry.Event)
	);
}

afterAll(async () => {
	await (await loadSentry())?.close();
	if (runtimeRelease === undefined) delete process.env.SENTRY_RELEASE;
	else process.env.SENTRY_RELEASE = runtimeRelease;
});

it('reports a server error without its message, request identity or source context', async () => {
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

	const events = reportedEvents();
	expect(events).toHaveLength(1);
	const [reported] = events;
	// Messages are content; the projection replaces them and keeps the request's
	// method and origin only. The route id names the path as written, so the path
	// goes with the query.
	expect(reported).toMatchObject({
		exception: { values: [{ type: 'Error', value: '[redacted]' }] },
		release: 'compiled-build',
		request: { method: 'GET', url: 'https://example.com' }
	});
	expect(reported).not.toHaveProperty('request.headers');
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
	expect(serialized).not.toContain('page=2');
	const frames = reported!.exception?.values?.[0]?.stacktrace?.frames ?? [];
	expect(frames.some((frame) => frame.filename?.endsWith('sentry.test.ts'))).toBe(true);
	for (const frame of frames) {
		for (const field of ['pre_context', 'context_line', 'post_context']) {
			expect(frame).not.toHaveProperty(field);
		}
	}
});

it('reports a failure a load recovered from to the request client', async () => {
	const { reportRecoveredFailure } = await import('#lib/server/recovered-failure.js');
	const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	const handle = await loadSentryHandle();
	const url = 'https://example.com/app';
	const event = {
		request: new Request(url),
		url: new URL(url),
		route: { id: '/app' },
		locals: {},
		isSubRequest: false
	} as unknown as RequestEvent;

	await handle!({
		event,
		resolve: async () => {
			reportRecoveredFailure('[test] Lookup failed', new Error('A recovered failure'));
			return new Response('fallback');
		}
	});
	await (await loadSentry())!.flush();
	const line = String(consoleError.mock.calls.at(-1)?.[0]);
	consoleError.mockRestore();

	const reported = reportedEvents().filter(
		(reportedEvent) => reportedEvent.exception?.values?.[0]?.mechanism?.type === 'recovered_failure'
	);
	expect(reported).toHaveLength(1);
	expect(reported[0]!.exception?.values?.[0]).toMatchObject({
		value: '[redacted]',
		mechanism: { handled: true }
	});
	expect(reported[0]!.release).toBe('compiled-build');
	// The event names the occurrence the console line names.
	expect(reported[0]!.contexts?.correlation).toEqual({
		diagnosticId: line.match(/ diagnostic=([0-9a-f]{16})/)?.[1]
	});
});
