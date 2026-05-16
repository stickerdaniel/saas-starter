import { afterEach, describe, expect, it } from 'vitest';
import { requireEnv } from './env';

const env = process.env as Record<string, string | undefined>;

function withMissing<T>(key: string, fn: () => T): T {
	const original = env[key];
	delete env[key];
	try {
		return fn();
	} finally {
		if (original === undefined) {
			delete env[key];
		} else {
			env[key] = original;
		}
	}
}

describe('requireEnv', () => {
	const SECRET_KEY = 'BETTER_AUTH_SECRET';
	const originalSecret = env[SECRET_KEY];

	afterEach(() => {
		if (originalSecret === undefined) {
			delete env[SECRET_KEY];
		} else {
			env[SECRET_KEY] = originalSecret;
		}
	});

	it('returns the env value when set', () => {
		env[SECRET_KEY] = 'real-value';
		expect(requireEnv('BETTER_AUTH_SECRET')).toBe('real-value');
	});

	it('falls back to analysis placeholder when env is unset', () => {
		// BETTER_AUTH_SECRET has an ANALYSIS_PLACEHOLDER, so it must not throw
		// when unset — the bundler relies on this during module analysis.
		delete env[SECRET_KEY];
		expect(requireEnv('BETTER_AUTH_SECRET')).toBe('placeholder-secret-for-analysis');
	});

	it('throws a structured error when no value and no placeholder', () => {
		// AUTH_EMAIL has no ANALYSIS_PLACEHOLDER entry, so an unset value must throw.
		withMissing('AUTH_EMAIL', () => {
			expect(() => requireEnv('AUTH_EMAIL')).toThrowError(
				/\[env\] Missing AUTH_EMAIL\n {2}Fix: bunx convex env set AUTH_EMAIL <value>\n {2}See: \.env\.convex\.example/
			);
		});
	});

	it('includes the feature name in the error message when provided', () => {
		withMissing('AUTH_EMAIL', () => {
			expect(() => requireEnv('AUTH_EMAIL', { feature: 'email delivery' })).toThrowError(
				/\[env\] Missing AUTH_EMAIL \(needed for: email delivery\)/
			);
		});
	});

	it('honors the custom docs path when provided', () => {
		withMissing('AUTH_EMAIL', () => {
			expect(() =>
				requireEnv('AUTH_EMAIL', { feature: 'email delivery', docs: 'docs/email.md' })
			).toThrowError(/See: docs\/email\.md/);
		});
	});
});
