import { describe, expect, it } from 'vitest';
import { redactCredentials, redactText } from './redact';

// Synthetic credentials in the shapes this code base carries.
const GRANT = 'a3'.repeat(32);
const JWT =
	'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9.c2lnbmF0dXJlLXNlbnRpbmVs';
const BEARER = 'bearer-sentinel-41f0';
const COOKIE = 'cookie-sentinel-77c2';
const CONVEX_KEY = 'dev:synthetic-deployment|0123456789abcdef0123456789abcdef';
const STORAGE_ID = '8c1f6c0e-2b7a-4d4e-9f6a-6b2f2b9e1c11';
const OPENAI_KEY = 'sk-proj-SyntheticKeySentinel1234567890';

describe('redactText', () => {
	it.each([
		['a grant echoed in a validator message', `Object: {writeGrant: "${GRANT}"}`, GRANT],
		[
			'a 64-hex signature inside prose',
			`signed ${GRANT.toUpperCase()} then failed`,
			GRANT.toUpperCase()
		],
		['a JWT', `token ${JWT} expired`, JWT],
		['a bearer header line', `Authorization: Bearer ${BEARER}`, BEARER],
		['a bare bearer value', `sent Bearer ${BEARER} upstream`, BEARER],
		['a Convex admin key', `Authorization: Convex ${CONVEX_KEY}`, CONVEX_KEY],
		['a Convex admin key in prose', `with Convex ${CONVEX_KEY} it failed`, CONVEX_KEY],
		['a cookie header', `Cookie: session=${COOKIE}; theme=dark`, COOKIE],
		['a set-cookie header', `set-cookie: better-auth.session=${COOKIE}`, COOKIE],
		['a provider key', `OPENAI_API_KEY=${OPENAI_KEY}`, OPENAI_KEY],
		['a query credential', `GET https://x.example/cb?code=${BEARER}&lang=en`, BEARER],
		[
			'a storage capability path',
			`GET https://c.example/api/storage/${STORAGE_ID} 404`,
			STORAGE_ID
		],
		['URL user info', `https://user:${BEARER}@sentry.example/1`, BEARER],
		[
			'a serialized payload',
			JSON.stringify({ args: JSON.stringify({ gatewaySignature: BEARER }) }),
			BEARER
		],
		['a quoted key value', `{"apiKey":"${BEARER}","model":"m"}`, BEARER],
		['a credential key with an object value', `{"token":{"value":"${BEARER}"}}`, BEARER],
		['a credential key spelled with JSON escapes', `{"\\u0074oken":"${BEARER}"}`, BEARER],
		['a credential in a JSON field name', `{"${GRANT}":1,"note":"ok"}`, GRANT],
		[
			'an object value nested in serialized arguments',
			JSON.stringify({ spec: JSON.stringify({ token: { value: BEARER } }) }),
			BEARER
		],
		['an object value in a cut payload', `{"token":{"value":"${BEARER}"},"spec":{"a`, BEARER],
		['an object value in prose', `rejected token: {value: ${BEARER}} upstream`, BEARER],
		['an object value the text never closes', `{"token":{"value":"${BEARER}`, BEARER],
		[
			'a header array in a serialized request',
			JSON.stringify({ headers: { Authorization: [`Token ${BEARER}`] } }),
			BEARER
		],
		[
			'a key value serialized three times',
			JSON.stringify({ body: JSON.stringify({ body: JSON.stringify({ apiKey: BEARER }) }) }),
			BEARER
		],
		[
			'a key value serialized four times',
			JSON.stringify({
				body: JSON.stringify({ body: JSON.stringify({ body: JSON.stringify({ apiKey: BEARER }) }) })
			}),
			BEARER
		],
		[
			'a storage URL whose id has no digit',
			'https://convex.example/api/storage/abcdefghijklmnopqrstuvwx',
			'abcdefghijklmnopqrstuvwx'
		],
		['a storage path without its origin', `GET /api/storage/${STORAGE_ID}`, STORAGE_ID]
	])('removes %s', (_label, text, secret) => {
		const redacted = redactText(text);
		expect(redacted).not.toContain(secret);
		expect(redacted).toContain('[Filtered]');
	});

	it.each([
		['the auth route template', 'GET /api/auth/[...all]'],
		['an auth endpoint without a credential segment', '/api/auth/get-session'],
		['an app route with harmless parameters', '/en/app/p/x7k2?support=open&lang=en'],
		['a chunk URL', 'https://example.com/_app/immutable/chunks/DF32kCgm.js'],
		['token counts', 'maxTokens: 4096, tokenCount: 12'],
		['a sentence about Convex', 'Convex rejected the mutation for chat_1'],
		['a release SHA', 'release 4259fcb24d1a6f2b8e0c9d7a5b3e1f0a2c4d6e8f']
	])('leaves %s as it is', (_label, text) => {
		expect(redactText(text)).toBe(text);
	});

	it.each([
		['/api/auth/reset-password/abc123', '/api/auth/reset-password/[Filtered]'],
		[
			'/api/auth/callback/google?code=c1&state=s1',
			'/api/auth/callback/[Filtered]?code=[Filtered]&state=[Filtered]'
		],
		['/en/x#access_token=t1&scope=a', '/en/x#access_token=[Filtered]&scope=a'],
		['/en/reset-password?%74oken=t1', '/en/reset-password?%74oken=[Filtered]'],
		['failed with api_key=k1 for user', 'failed with api_key=[Filtered] for user'],
		['rejected token: {value: v1} upstream', 'rejected token: [Filtered] upstream']
	])('redacts %s', (text, expected) => {
		expect(redactText(text)).toBe(expected);
	});

	const HEADER_TOKEN = '0123456789abcdef0123456789abcdef01234567';

	it.each([
		['on its line', `Authorization: Token ${HEADER_TOKEN}`, 'Authorization: [Filtered]'],
		['quoted on its line', `Authorization: "Token ${HEADER_TOKEN}"`, 'Authorization: "[Filtered]"'],
		[
			'wrapped onto the next line',
			`Authorization:\n  Token ${HEADER_TOKEN}\nnext`,
			'Authorization: [Filtered]\nnext'
		],
		[
			'quoted on the next line',
			`Authorization:    \n  "Token ${HEADER_TOKEN}"\nnext`,
			'Authorization:    \n  "[Filtered]"\nnext'
		],
		[
			'an array on the next line',
			`authorization:\r\n  ["Token ${HEADER_TOKEN}"]\r\nnext`,
			'authorization:\r\n  [Filtered]\r\nnext'
		]
	])('filters a header value %s', (_label, text, expected) => {
		expect(redactText(text)).toBe(expected);
	});

	it('is stable on its own output', () => {
		const once = redactText(
			`Authorization: Bearer ${BEARER} {"writeGrant":"${GRANT}"} ?token=x ` +
				JSON.stringify({ headers: { Authorization: ['Token t'] } })
		);
		expect(redactText(once)).toBe(once);
	});

	// Each word is shaped to start a pattern at every position inside it. A scan
	// that backtracks quadratically over 1 MB runs for minutes. The linear one took
	// up to 430 ms on a host with a load average of 190, so the budget leaves room
	// for a loaded CI runner.
	it.each([
		['a word without a credential key', 'a'.repeat(1_000_000)],
		['a hyphenated word', 'x-'.repeat(500_000)],
		['repeated JWT headers', '-eyJ'.repeat(250_000)],
		['a run of backslashes', '\\'.repeat(1_000_000)],
		['repeated keys with unclosed arrays', 'token=['.repeat(142_858)],
		['repeated keys with unclosed quotes', 'password: "a '.repeat(76_924)],
		['repeated query parameters', '&a='.repeat(333_334)]
	])('finishes %s of 1 MB within a fixed budget', (_label, word) => {
		const started = performance.now();
		redactText(`failed: ${word}`);
		expect(performance.now() - started).toBeLessThan(2_500);
	});

	it('cuts a long text at its bound and marks the cut', () => {
		const redacted = redactText('word '.repeat(20_000));

		expect(redacted.length).toBeLessThan(64 * 1024 + 40);
		expect(redacted).toMatch(/\[truncated \d+ chars\]$/);
	});

	const CUT = 64 * 1024;
	/** `tail` placed so that the 64 KiB cut falls `before` characters before its end. */
	const acrossTheCut = (tail: string, before: number) =>
		`${'x '.repeat(CUT).slice(0, CUT - tail.length + before)}${tail}`;
	const TOKEN = '0123456789abcdef0123456789abcdef01234567';

	it.each([
		[
			'a serialized header cut before its escaped closing quote',
			acrossTheCut(
				JSON.stringify({ body: JSON.stringify({ headers: { Authorization: `Token ${TOKEN}` } }) }),
				5
			),
			TOKEN
		],
		[
			'a quoted password with punctuation split by the cut',
			acrossTheCut(`{"password":"p,a;s}s w&o]rd-${TOKEN}"}`, 20),
			'p,a;s}s w&o]rd'
		],
		['a grant split by the cut', acrossTheCut(GRANT, 24), GRANT],
		['a JWT cut before its signature', acrossTheCut(JWT, 30), JWT.split('.')[1]!]
	])('redacts %s before cutting', (_label, input, secret) => {
		const redacted = redactText(input);

		expect(input.length).toBeGreaterThan(CUT);
		expect(redacted).not.toContain(secret.slice(0, 8));
		expect(redacted.length).toBeLessThanOrEqual(CUT + 40);
	});

	it.each([
		[
			'a header array',
			`{"Authorization":["Token ${TOKEN}", "x\nnext line`,
			'{"Authorization":[Filtered]'
		],
		['a quoted password', `password: "p,a;s\n${TOKEN}`, 'password: "[Filtered]"'],
		['an escaped quote', `{\\"apiKey\\":\\"${TOKEN}`, '{\\"apiKey\\":\\"[Filtered]\\"']
	])('filters %s that never closes to the end of the text', (_label, text, expected) => {
		expect(redactText(text)).toBe(expected);
	});

	// Text over 1 MiB is cut before redaction. A hex run in front collapses to
	// one marker, so what stood at that cut reaches the output.
	const hexRun = (length: number) => `${'f'.repeat(length - 1)} `;

	// Each value spans lines and stays open past the cut, so the credential on
	// its second line is not where a line-bound pattern would look.
	it.each([
		['a quote', `password: "p,a;s\n${TOKEN} and more`],
		['an escaped quote', `\\"apiKey\\":\\"x\n${TOKEN} and more`],
		['an array', `authorization: [Token\n${TOKEN} and more`]
	])('closes %s that a text over 1 MiB leaves open at its cut', (_label, opening) => {
		const redacted = redactText(`${hexRun(1024 * 1024 - 100)}${opening}${' x'.repeat(100)}`);

		expect(redacted).not.toContain(TOKEN.slice(0, 8));
		expect(redacted).toMatch(/\[truncated \d+ chars\]$/);
	});

	it('drops the part of a grant that the 1 MiB cut leaves behind', () => {
		// The grant starts 24 characters before the cut.
		const redacted = redactText(`${hexRun(1024 * 1024 - 24)}${GRANT}`);

		expect(redacted).not.toContain(GRANT.slice(0, 8));
		expect(redacted).toMatch(/\[truncated \d+ chars\]$/);
	});
});

describe('redactCredentials', () => {
	it('removes credential fields by name and credential shapes in every string', () => {
		const input = {
			text: 'the user said hello',
			writeGrant: 'opaque-grant',
			nested: [{ headers: { authorization: 'Convex x', cookie: COOKIE, 'x-api-key': 'k' } }],
			detail: `rejected ${GRANT}`,
			maxTokens: 12
		};

		expect(redactCredentials(input)).toEqual({
			text: 'the user said hello',
			writeGrant: '[Filtered]',
			nested: [
				{
					headers: { authorization: '[Filtered]', cookie: '[Filtered]', 'x-api-key': '[Filtered]' }
				}
			],
			detail: 'rejected [Filtered]',
			maxTokens: 12
		});
		// The input is evidence the caller still holds.
		expect(input.writeGrant).toBe('opaque-grant');
	});

	it('bounds a cycle and turns a class instance into its text', () => {
		const cyclic: Record<string, unknown> = { name: 'loop' };
		cyclic.self = cyclic;

		expect(
			redactCredentials({ cyclic, when: new URL(`https://x.example/?token=${BEARER}`) })
		).toEqual({
			cyclic: { name: 'loop', self: '[circular]' },
			when: 'https://x.example/?token=[Filtered]'
		});
	});
});
