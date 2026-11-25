// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { convexModules } from './convexTest.modules';

const getUsability = () =>
	convexTest(schema, convexModules).query(api.capabilities.getUsability, {});

const providerKeys = [
	'RESEND_API_KEY',
	'AUTH_EMAIL',
	'EMAIL_ASSET_URL',
	'AUTUMN_SECRET_KEY',
	'OPENROUTER_API_KEY'
] as const;

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('public capability usability', () => {
	it('exposes only aggregate billing and AI usability', async () => {
		vi.stubEnv('CAPABILITY_PROFILE', 'local');
		for (const key of providerKeys) vi.stubEnv(key, '');

		const result = await getUsability();

		expect(result).toEqual({
			billing: { usable: false, reason: 'unavailable' },
			ai: { usable: false, reason: 'unavailable' }
		});
		const serialized = JSON.stringify(result);
		for (const forbidden of [
			'email',
			'profile',
			'RESEND',
			'AUTH_EMAIL',
			'ASSET_URL',
			'AUTUMN',
			'OPENROUTER',
			'missing',
			'incomplete',
			'invalid',
			'sentinel',
			'disabled',
			'misconfigured'
		]) {
			expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
		}
	});

	it('reports ready providers without exposing their values', async () => {
		vi.stubEnv('CAPABILITY_PROFILE', 'production');
		vi.stubEnv('RESEND_API_KEY', 'configured-email-key');
		vi.stubEnv('AUTH_EMAIL', 'sender@example.com');
		vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');
		vi.stubEnv('AUTUMN_SECRET_KEY', 'configured-billing-key');
		vi.stubEnv('OPENROUTER_API_KEY', 'configured-ai-key');

		const result = await getUsability();

		expect(result).toEqual({ billing: { usable: true }, ai: { usable: true } });
		expect(JSON.stringify(result)).not.toContain('configured');
	});
});
