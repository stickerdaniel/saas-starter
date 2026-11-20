import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityConfigurationError, requireCapabilityConfiguration, requireEnv } from './env';

const env = process.env as Record<string, string | undefined>;

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
});

describe('requireCapabilityConfiguration', () => {
	it.each(['disabled', 'misconfigured'] as const)(
		'rejects %s configuration without exposing provider details',
		(state) => {
			expect(() =>
				requireCapabilityConfiguration(
					'billing',
					state === 'disabled' ? { state } : { state, issue: 'missing' }
				)
			).toThrowError(CapabilityConfigurationError);
		}
	);

	it('returns only the normalized ready value', () => {
		expect(
			requireCapabilityConfiguration('ai', {
				state: 'ready',
				value: { apiKey: 'configured' }
			})
		).toEqual({ apiKey: 'configured' });
	});
});
