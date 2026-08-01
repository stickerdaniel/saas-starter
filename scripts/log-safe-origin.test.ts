// The ignored-SITE_URL warning is the one place a `.env.convex.local` value
// still reaches the console, and that file holds secrets. A URL a developer
// typed can carry userinfo or a query token, so only the origin is logged.

import { describe, expect, it } from 'vitest';
import { logSafeOrigin } from './local-convex-env';

describe('logSafeOrigin', () => {
	it('drops userinfo, path, query and fragment', () => {
		expect(logSafeOrigin('https://user:pw@example.com:8443/p?token=abc#f')).toBe(
			'https://example.com:8443'
		);
		expect(logSafeOrigin('https://example.com/x?k=secret')).toBe('https://example.com');
	});

	it('keeps the ordinary local case intact, so the warning stays useful', () => {
		expect(logSafeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
	});

	// parseEnvFile accepts any non-empty string, so a malformed value reaches here.
	it('does not echo a value it cannot parse', () => {
		expect(logSafeOrigin('not a url with a secret in it')).toBe('<unparseable>');
	});
});
