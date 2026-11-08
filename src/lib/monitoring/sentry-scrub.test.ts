import type { ErrorEvent, Event } from '@sentry/sveltekit';
import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

const CONTENT = 'conversation-marker-5e1d';

// A browser error event as @sentry/svelte 11.10.0 built it on the reset page,
// before this scrubber. The SDK had already filtered `token=` values by name; the
// Referer header, the auth path and the navigation breadcrumb kept theirs.
function browserEvent(): ErrorEvent {
	return {
		type: undefined,
		exception: {
			values: [
				{
					type: 'Error',
					value: `reset page failed for ${CONTENT}`,
					stacktrace: {
						frames: [
							{
								filename: 'https://example.com/_app/immutable/chunks/DF32kCgm.js',
								function: '?',
								in_app: true,
								lineno: 1,
								colno: 420
							},
							{
								// An inline script's frame names the page it ran on.
								filename: 'https://example.com/en/reset-password?token=frame-query-sentinel',
								abs_path: 'https://example.com/en/reset-password#token=frame-fragment-sentinel',
								function: '?',
								in_app: true,
								lineno: 1,
								colno: 82
							}
						]
					},
					mechanism: { type: 'auto.function.sveltekit.handle_error', handled: true }
				}
			]
		},
		level: 'error',
		platform: 'javascript',
		// The browser SDK names the scope after the route id once SvelteKit resolved it.
		transaction: '/[[lang=lang]]/reset-password',
		request: {
			url: 'https://example.com/en/reset-password?token=reset-query-sentinel',
			headers: {
				Referer:
					'https://example.com/api/auth/reset-password/referer-path-sentinel?callbackURL=%2Fen',
				'User-Agent': 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.3'
			}
		},
		environment: 'staging',
		release: 'scrub-test-release',
		extra: { draft: CONTENT },
		user: { id: 'user-sentinel' },
		tags: { operation: 'composer.send', draft: CONTENT },
		contexts: {
			correlation: { chatId: 'chat_1', voiceSessionId: 'voice_1', draft: CONTENT },
			composer: { draft: CONTENT }
		},
		breadcrumbs: [
			{
				timestamp: 1793819710.486,
				category: 'navigation',
				data: { from: '/en/signin', to: '/en/reset-password?token=navigation-sentinel-6a31' }
			},
			{
				timestamp: 1793819710.49,
				category: 'ui.input',
				message: `typed ${CONTENT}`,
				level: 'info'
			}
		]
	};
}

describe('Sentry scrubbing', () => {
	it('keeps a browser event to its shape, route and correlation ids', () => {
		const scrubbed = scrubEvent(browserEvent());
		const wire = JSON.stringify(scrubbed);

		for (const sentinel of [
			CONTENT,
			'reset-query-sentinel',
			'frame-query-sentinel',
			'frame-fragment-sentinel',
			'referer-path-sentinel',
			'navigation-sentinel',
			'user-sentinel'
		]) {
			expect(wire, sentinel).not.toContain(sentinel);
		}
		expect(wire).not.toMatch(/"referr?er"/i);
		expect(scrubbed.exception?.values?.[0]).toMatchObject({ type: 'Error', value: '[redacted]' });
		expect(scrubbed.request).toEqual({
			url: 'https://example.com/[[lang=lang]]/reset-password',
			headers: {
				'User-Agent': 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.3'
			}
		});
		expect(scrubbed.breadcrumbs).toEqual([
			{ category: 'navigation', timestamp: 1793819710.486 },
			{ category: 'ui.input', level: 'info', timestamp: 1793819710.49 }
		]);
		expect(scrubbed.tags).toEqual({ operation: 'composer.send' });
		expect(scrubbed.contexts).toEqual({
			correlation: { chatId: 'chat_1', voiceSessionId: 'voice_1' }
		});
		// What triage needs stays.
		expect(wire).toContain('https://example.com/_app/immutable/chunks/DF32kCgm.js');
		expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[1]).toMatchObject({
			filename: 'https://example.com/en/reset-password',
			abs_path: 'https://example.com/en/reset-password',
			lineno: 1,
			colno: 82
		});
		expect(wire).toContain('"environment":"staging"');
		expect(wire).toContain('"release":"scrub-test-release"');
	});

	it.each([
		[
			"Cannot read properties of undefined (reading '" + 'a9'.repeat(32) + "')",
			"Cannot read properties of undefined (reading '…')"
		],
		[
			"undefined is not an object (evaluating '" + 'a1'.repeat(32) + "')",
			"undefined is not an object (evaluating '…')"
		],
		['CONTENT_private_quote is not a function', '… is not a function'],
		[
			"CONTENT_x is not a function. (In 'CONTENT_x()', 'CONTENT_x' is undefined)",
			"… is not a function. (In '…()', '…' is undefined)"
		],
		['CONTENT_x is not defined', '… is not defined'],
		["Cannot access 'CONTENT_x' before initialization.", "Cannot access '…' before initialization"],
		['Maximum call stack size exceeded.', 'Maximum call stack size exceeded'],
		['said CONTENT_x is not a function', '[redacted]']
	])('keeps the engine wording of %j and none of its program text', (value, expected) => {
		const scrubbed = scrubEvent({ exception: { values: [{ type: 'TypeError', value }] } });

		expect(scrubbed.exception?.values?.[0]?.value).toBe(expected);
	});

	it('records a breadcrumb as category and level only', () => {
		expect(
			scrubBreadcrumb({
				category: 'navigation',
				level: 'info',
				timestamp: 1,
				data: { to: '/en/app?state=oauth-state-sentinel' }
			})
		).toEqual({ category: 'navigation', level: 'info', timestamp: 1 });
	});

	it('keeps span identities and timings and drops their attributes', () => {
		const transaction: Event = {
			type: 'transaction',
			transaction: 'GET /api/auth/[...all]',
			transaction_info: { source: 'route' },
			contexts: {
				trace: {
					trace_id: 't',
					span_id: 's',
					op: 'http.server',
					data: {
						'sentry.op': 'http.server',
						'http.request.header.referer': ['https://example.com/en/x?q=1'],
						'url.full': 'https://example.com/en/reset-password?%74oken=encoded-sentinel'
					}
				}
			},
			spans: [
				{
					span_id: 'c',
					trace_id: 't',
					start_timestamp: 1,
					timestamp: 2,
					op: 'http.client',
					status: 'ok',
					description: 'GET https://example.com/api/auth/reset-password/fetch-path-sentinel',
					data: { 'sentry.op': 'http.client', 'url.full': 'https://x.example/?token=span-sentinel' }
				}
			]
		};

		const scrubbed = scrubEvent(transaction);

		expect(scrubbed.contexts?.trace).toEqual({
			trace_id: 't',
			span_id: 's',
			op: 'http.server',
			data: { 'sentry.op': 'http.server' }
		});
		expect(scrubbed.spans).toEqual([
			{
				span_id: 'c',
				trace_id: 't',
				start_timestamp: 1,
				timestamp: 2,
				op: 'http.client',
				status: 'ok',
				description: 'GET https://example.com',
				data: { 'sentry.op': 'http.client' }
			}
		]);
		expect(scrubbed.transaction).toBe('GET /api/auth/[...all]');
	});

	const span = (span_id: string, description: string) => ({
		span_id,
		trace_id: 't',
		start_timestamp: 1,
		status: 'ok',
		data: {},
		description
	});

	it('names a request by its route id and a span by its origin', () => {
		const scrubbed = scrubEvent({
			type: 'transaction',
			transaction: 'GET /[[lang]]/[...path]',
			transaction_info: { source: 'route' },
			request: {
				method: 'GET',
				url: `https://example.com/en/supplier-confidential?q=${CONTENT}`
			},
			spans: [
				span('a', 'GET http://127.0.0.1:49645/documents/supplier-confidential'),
				span('b', `GET https://example.com/en/app/p/x7k2kq9w/chat#${CONTENT}`),
				span('c', `render ${CONTENT}`)
			]
		} satisfies Event);

		const wire = JSON.stringify(scrubbed);
		expect(wire).not.toContain(CONTENT);
		expect(wire).not.toContain('supplier-confidential');
		expect(scrubbed.request?.url).toBe('https://example.com/[[lang]]/[...path]');
		expect(scrubbed.transaction).toBe('GET /[[lang]]/[...path]');
		expect(scrubbed.spans?.map(({ description }) => description)).toEqual([
			'GET http://127.0.0.1:49645',
			'GET https://example.com',
			undefined
		]);
	});

	it.each([
		[
			'a transaction named after its URL',
			{
				type: 'transaction',
				transaction: 'GET /en/supplier-confidential',
				transaction_info: { source: 'url' },
				request: { url: 'https://example.com/en/supplier-confidential' }
			}
		],
		[
			'an error named after its request target',
			{
				type: undefined,
				transaction: 'GET /en/(supplier-confidential)?q=1',
				request: { url: 'https://example.com/a/../en/(supplier-confidential)' }
			}
		],
		[
			'a route-shaped name with a free-text segment',
			{
				type: 'transaction',
				transaction: 'GET /[[lang]]/supplier-confidential_Q3.pdf',
				transaction_info: { source: 'route' },
				request: { url: 'https://example.com/en/supplier-confidential_Q3.pdf' }
			}
		],
		[
			'a browser error named after its page path',
			{
				type: undefined,
				transaction: '/en/supplier-confidential',
				request: { url: 'https://example.com/en/supplier-confidential' }
			}
		],
		[
			'a navigation named after its destination path',
			{
				type: 'transaction',
				transaction: '/en/(supplier-confidential)',
				transaction_info: { source: 'url' },
				request: { url: 'https://example.com/en/app' }
			}
		],
		[
			'a browser error named after the page it navigates to',
			{
				type: undefined,
				transaction: '/en/supplier-confidential',
				request: { url: 'https://example.com/en/app' }
			}
		],
		[
			'an error named after a path with no request beside it',
			{ type: undefined, transaction: '/en/supplier-confidential' }
		]
	] satisfies Array<[string, Event]>)('keeps only the origin of %s', (_label, event: Event) => {
		const scrubbed = scrubEvent(event);

		expect(JSON.stringify(scrubbed)).not.toContain('supplier-confidential');
		expect(scrubbed.transaction).toBe('[redacted]');
		if (event.request) expect(scrubbed.request?.url).toBe('https://example.com');
	});

	it('keeps a browser route id as the transaction name', () => {
		expect(
			scrubEvent({
				type: 'transaction',
				transaction: '/[[lang=lang]]/app/(chat)/p/[projectId]',
				transaction_info: { source: 'route' }
			}).transaction
		).toBe('/[[lang=lang]]/app/(chat)/p/[projectId]');
	});

	it('redacts a credential in a route id', () => {
		const scrubbed = scrubEvent({
			type: 'transaction',
			transaction: `GET /share/${'a3'.repeat(32)}/[id]`,
			transaction_info: { source: 'route' },
			request: { url: `https://example.com/share/${'a3'.repeat(32)}/x` }
		});

		expect(scrubbed.transaction).toBe('GET /share/[Filtered]/[id]');
		expect(scrubbed.request?.url).toBe('https://example.com/share/[Filtered]/[id]');
	});
});
