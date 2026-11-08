// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import type { RequestEvent } from '@sveltejs/kit';
import type { HandleServerError } from '@sveltejs/kit/hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ browser: false, version: 'scrub-test-release' }));
// Read when ./sentry first loads the SDK, after the local ingest below listens.
vi.mock('$app/env/public', () => ({
	get PUBLIC_SENTRY_DSN() {
		return `${origin.replace('://', '://publickey@')}/1`;
	}
}));

// The real SDK sends to a local ingest, so the assertions read the envelopes
// exactly as the wire carries them.
const envelopes: string[] = [];
let ingest: Server;
let origin: string;

function body(request: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

beforeAll(async () => {
	ingest = createServer(async (request, response) => {
		const bytes = await body(request);
		if (request.url?.includes('/envelope/')) {
			const gzip = request.headers['content-encoding'] === 'gzip';
			envelopes.push((gzip ? gunzipSync(bytes) : bytes).toString('utf8'));
		}
		response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
	});
	await new Promise<void>((resolve) => ingest.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(ingest.address() as AddressInfo).port}`;
	// The Node SDK reads its environment from here when the options name none.
	vi.stubEnv('SENTRY_ENVIRONMENT', 'scrub-test-environment');
});

afterAll(async () => {
	await (await import('./sentry')).loadedSentry()?.close();
	vi.unstubAllEnvs();
	await new Promise((resolve) => ingest.close(resolve));
});

// The URL shapes Better Auth and the reset page actually use, one sentinel each.
const SENTINELS = {
	resetPath: 'reset-path-sentinel-7f3a',
	resetQuery: 'reset-query-sentinel-91c2',
	nestedCallback: 'nested-callback-sentinel-4d0e',
	verifyQuery: 'verify-query-sentinel-b6e8',
	referer: 'referer-sentinel-25af',
	encodedReferer: 'encoded-referer-sentinel-e042',
	fetchPath: 'fetch-path-sentinel-c17d',
	// What the failure itself carries: conversation content and credentials in
	// its message and cause.
	content: 'conversation-marker-2a9f',
	bearer: 'bearer-sentinel-6e31',
	grant: 'd4'.repeat(32),
	jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.jwt-signature-sentinel',
	cookie: 'cookie-sentinel-90bd',
	storagePath: '5d0c2b1e-8f3a-4c6d-9e7b-1a2b3c4d5e6f',
	// What a caller and the program put around a request: a search in its
	// query, a property named after a grant, and baggage the caller wrote.
	searched: 'CONTENT_private_supplier_quote',
	propertyGrant: 'a9'.repeat(32),
	baggageRelease: 'b8'.repeat(32),
	baggageEnvironment: 'baggage-environment-sentinel',
	// A page path and a document path that name what the user opened.
	openedPath: 'supplier-confidential'
};

function authEvent(
	path: string,
	referer: string,
	method = 'GET',
	headers: Record<string, string> = {}
): RequestEvent {
	const url = new URL(`https://example.com${path}`);
	const request = new Request(url, {
		method,
		headers: { referer, 'user-agent': 'scrub-test', ...headers }
	});
	return {
		url,
		request,
		route: { id: '/api/auth/[...all]' },
		params: { all: url.pathname.slice('/api/auth/'.length) },
		isSubRequest: false,
		locals: {},
		getClientAddress: () => '203.0.113.9'
	} as unknown as RequestEvent;
}

describe('Sentry envelopes from the server handlers', () => {
	it('carry no credential from an auth URL, a Referer or a breadcrumb', async () => {
		const { loadSentry, loadSentryHandle } = await import('./sentry');
		const sentry = await loadSentry();
		const handle = await loadSentryHandle();
		if (!sentry || !handle) throw new Error('Sentry did not initialize');
		// The server SDK initializes on the first request through the hook.
		await handle({
			event: authEvent('/api/auth/ok', 'https://example.com/en/app'),
			resolve: async () => new Response('{}', { status: 200 })
		});
		// Sampled here so the transaction path is exercised on every run, not one in ten.
		sentry.getClient()!.getOptions().tracesSampleRate = 1;

		// Typed as src/hooks.server.ts types it.
		const handleError = sentry.handleErrorWithSentry<HandleServerError>(() => {});
		const requests = [
			authEvent(
				`/api/auth/reset-password/${SENTINELS.resetPath}?token=${SENTINELS.resetQuery}` +
					`&callbackURL=${encodeURIComponent(`/en/reset-password?token=${SENTINELS.nestedCallback}`)}`,
				`https://example.com/en/reset-password?token=${SENTINELS.referer}`
			),
			authEvent(
				`/api/auth/verify-email?token=${SENTINELS.verifyQuery}&callbackURL=%2Fen%2Fapp`,
				`https://example.com/en/signin?token=${SENTINELS.referer}`
			)
		];
		for (const event of requests) {
			// What Kit does for a route that throws: report through handleError
			// inside the request, then answer 500.
			await handle({
				event,
				resolve: async (resolved) => {
					// A real outgoing fetch, so the fetch integration records its breadcrumb.
					await fetch(`${origin}/api/auth/reset-password/${SENTINELS.fetchPath}`);
					sentry.addBreadcrumb({ category: 'ui.input', message: `typed ${SENTINELS.content}` });
					try {
						throw new Error(`auth upstream failed for ${SENTINELS.content}`, {
							cause: new Error(
								`Authorization: Bearer ${SENTINELS.bearer}\n` +
									`token ${SENTINELS.jwt} grant ${SENTINELS.grant}\n` +
									`Cookie: session=${SENTINELS.cookie}\n` +
									`GET https://convex.example/api/storage/${SENTINELS.storagePath}`
							)
						});
					} catch (error) {
						await handleError({ kind: 'unknown', error, event: resolved });
					}
					return new Response('', { status: 500 });
				}
			});
		}
		// A reset that succeeds: the page read `?%74oken=` as its token, and the
		// sampled POST transaction repeats the page URL as a span attribute.
		await handle({
			event: authEvent(
				'/api/auth/reset-password',
				`https://example.com/en/reset-password?%74oken=${SENTINELS.encodedReferer}`,
				'POST'
			),
			resolve: async () => new Response('{}', { status: 200 })
		});
		// A continued trace whose caller searched for content, and whose
		// baggage names a transaction, release and environment of its own.
		await handle({
			event: authEvent(
				`/api/auth/get-session?q=${SENTINELS.searched}`,
				'https://example.com/en/app',
				'GET',
				{
					'sentry-trace': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1',
					baggage: [
						'sentry-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
						'sentry-public_key=publickey',
						`sentry-transaction=${SENTINELS.searched}`,
						`sentry-release=${SENTINELS.baggageRelease}`,
						`sentry-environment=${SENTINELS.baggageEnvironment}`,
						'sentry-sample_rand=0.3410122946370393'
					].join(',')
				}
			),
			resolve: async (resolved) => {
				await fetch(`${origin}/external-document?search=${SENTINELS.searched}`);
				const holder: { session?: Record<string, string> } = {};
				try {
					holder.session![SENTINELS.propertyGrant]?.toString();
				} catch (error) {
					await handleError({ kind: 'unknown', error, event: resolved });
				}
				return new Response('', { status: 500 });
			}
		});
		// A page served by the catch-all route, which fetches the document it names.
		await handle({
			event: {
				...authEvent(`/en/${SENTINELS.openedPath}`, 'https://example.com/en/app'),
				route: { id: '/[[lang]]/[...path]' }
			},
			resolve: async (resolved) => {
				await fetch(`${origin}/documents/${SENTINELS.openedPath}`);
				await handleError({ kind: 'unknown', error: new Error('render failed'), event: resolved });
				return new Response('', { status: 500 });
			}
		});
		await sentry.flush(5_000);

		const wire = envelopes.join('\n');
		expect(wire).toContain('"type":"event"');
		expect(wire).toContain('"type":"transaction"');
		for (const sentinel of Object.values(SENTINELS)) {
			expect(wire, sentinel).not.toContain(sentinel);
		}
		expect(wire).not.toMatch(/"referer"/i);
		// Envelope headers carry the SDK's own trace fields; the continued trace
		// keeps its id and loses what its baggage named.
		const traces = envelopes.map(
			(envelope) => (JSON.parse(envelope.split('\n')[0]!) as { trace?: object }).trace
		);
		expect(traces).toContainEqual(
			expect.objectContaining({ trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
		);
		for (const trace of traces) {
			expect(Object.keys(trace ?? {})).not.toEqual(
				expect.arrayContaining([expect.stringMatching(/^(?:transaction|release|environment)$/)])
			);
		}
		expect(wire).toContain('"value":"Cannot read properties of undefined (reading \'…\')"');
		// An outgoing request keeps its method and origin.
		expect(wire).toContain(`"description":"GET ${origin}"`);
		// Triage still works: the route, the error's type and where it was thrown,
		// and the environment and build it came from.
		expect(wire).toContain('"url":"https://example.com/api/auth/[...all]"');
		expect(wire).toContain('"url":"https://example.com/[[lang]]/[...path]"');
		expect(wire).toContain('"transaction":"GET /[[lang]]/[...path]"');
		expect(wire).toContain('"type":"Error","value":"[redacted]"');
		expect(wire).toContain('"category":"ui.input"');
		expect(wire).toContain('sentry-scrub.envelope.test.ts');
		expect(wire).toContain('"environment":"scrub-test-environment"');
		expect(wire).toContain('"release":"scrub-test-release"');
	});
});
