import { describe, expect, it } from 'vitest';
import { stripSensitiveManifestValues } from './strip-varlock-secrets';

function fixture() {
	return {
		settings: { redactLogs: true },
		config: {
			PUBLIC_CONVEX_URL: { value: 'https://example.convex.cloud', isSensitive: false },
			CONVEX_DEPLOY_KEY: { value: 'prod:secret-deploy-key', isSensitive: true },
			CONVEX_MANAGEMENT_TOKEN: { value: 'mgmt-token', isSensitive: true },
			CONVEX_INTERNAL_URL: { value: 'http://convex:3210', isSensitive: true },
			// Already-unset sensitive var: no value key at all
			SENTRY_AUTH_TOKEN: { isSensitive: true },
			VARLOCK_ENV: { value: 'production', isSensitive: false }
		}
	};
}

describe('stripSensitiveManifestValues', () => {
	it('drops the value of every @sensitive entry', () => {
		const stripped = stripSensitiveManifestValues(fixture());
		for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_MANAGEMENT_TOKEN', 'CONVEX_INTERNAL_URL']) {
			expect(stripped.config[key], key).not.toHaveProperty('value');
		}
	});

	it('keeps the value of non-sensitive entries intact', () => {
		const stripped = stripSensitiveManifestValues(fixture());
		expect(stripped.config.PUBLIC_CONVEX_URL.value).toBe('https://example.convex.cloud');
		expect(stripped.config.VARLOCK_ENV.value).toBe('production');
	});

	it('preserves every key and its isSensitive flag (structure stays intact)', () => {
		const original = fixture();
		const stripped = stripSensitiveManifestValues(fixture());
		expect(Object.keys(stripped.config)).toEqual(Object.keys(original.config));
		for (const key of Object.keys(original.config)) {
			expect(stripped.config[key].isSensitive, key).toBe(original.config[key].isSensitive);
		}
	});

	it('produces the same shape for a stripped var as an already-unset sensitive var', () => {
		const stripped = stripSensitiveManifestValues(fixture());
		// SENTRY_AUTH_TOKEN was already valueless; CONVEX_DEPLOY_KEY had a value that got dropped
		expect(stripped.config.CONVEX_DEPLOY_KEY).toEqual(stripped.config.SENTRY_AUTH_TOKEN);
	});

	it('mutates in place and returns the same reference', () => {
		const manifest = fixture();
		expect(stripSensitiveManifestValues(manifest)).toBe(manifest);
	});

	it('tolerates a missing or empty manifest', () => {
		expect(stripSensitiveManifestValues(undefined)).toBeUndefined();
		expect(stripSensitiveManifestValues(null)).toBeNull();
		expect(stripSensitiveManifestValues({})).toEqual({});
	});
});
