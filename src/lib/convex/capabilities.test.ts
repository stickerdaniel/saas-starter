import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_generated/server', () => ({
	env: process.env,
	query: (definition: { handler: unknown }) => ({ ...definition, _handler: definition.handler })
}));

type RegisteredQuery = {
	_handler: () => Promise<unknown>;
};

const providerKeys = [
	'RESEND_API_KEY',
	'AUTH_EMAIL',
	'EMAIL_ASSET_URL',
	'AUTUMN_SECRET_KEY',
	'OPENROUTER_API_KEY'
] as const;

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('public capability usability', () => {
	it('exposes only aggregate billing and AI usability', async () => {
		vi.stubEnv('CAPABILITY_PROFILE', 'local');
		for (const key of providerKeys) vi.stubEnv(key, '');

		const { getUsability } = await import('./capabilities');
		const result = await (getUsability as unknown as RegisteredQuery)._handler();

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

		const { getUsability } = await import('./capabilities');
		const result = await (getUsability as unknown as RegisteredQuery)._handler();

		expect(result).toEqual({ billing: { usable: true }, ai: { usable: true } });
		expect(JSON.stringify(result)).not.toContain('configured');
	});
});
