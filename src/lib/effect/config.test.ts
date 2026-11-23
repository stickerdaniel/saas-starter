import type * as EffectModule from 'effect/Effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityUnavailable } from './config';

vi.mock('../convex/_generated/server', () => ({ env: process.env }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

const load = async () => {
	const Effect = await import('effect/Effect');
	const config = await import('./config');
	return { Effect, config };
};

describe('requireEnv', () => {
	it('reads the value at run time, not at import', async () => {
		vi.stubEnv('SITE_URL', '');
		const { Effect, config } = await load();
		const siteUrl = config.requireEnv('SITE_URL');
		vi.stubEnv('SITE_URL', 'https://app.example.com');
		expect(Effect.runSync(siteUrl)).toBe('https://app.example.com');
	});

	it('keeps the analysis placeholder for an unset key read at module load', async () => {
		vi.stubEnv('BETTER_AUTH_SECRET', '');
		const { Effect, config } = await load();
		expect(Effect.runSync(config.requireEnv('BETTER_AUTH_SECRET'))).toBe(
			'placeholder-secret-for-analysis'
		);
	});
});

describe('capability configuration', () => {
	it('returns the ready provider value', async () => {
		vi.stubEnv('CAPABILITY_PROFILE', 'local');
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-configured');
		const { Effect, config } = await load();
		expect(Effect.runSync(config.aiConfiguration)).toEqual({ apiKey: 'sk-or-v1-configured' });
	});

	it.each([
		['billing', 'billingConfiguration', 'AUTUMN_SECRET_KEY'],
		['email', 'emailConfiguration', 'RESEND_API_KEY'],
		['ai', 'aiConfiguration', 'OPENROUTER_API_KEY']
	] as const)(
		'fails with %s and its state when its key is unset',
		async (capability, effect, key) => {
			vi.stubEnv('CAPABILITY_PROFILE', 'local');
			vi.stubEnv(key, '');
			const { Effect, config } = await load();
			const { getCapabilityConfigurations } = await import('../confect/env');
			const program: EffectModule.Effect<unknown, CapabilityUnavailable> = config[effect];
			const failure = Effect.runSync(Effect.flip(program));
			expect(failure).toMatchObject({
				_tag: 'CapabilityUnavailable',
				capability,
				state: getCapabilityConfigurations()[capability].state
			});
			expect(failure.state).not.toBe('ready');
		}
	);
});

describe('oauthProviders', () => {
	it('reports a provider without credentials as disabled', async () => {
		vi.stubEnv('AUTH_GOOGLE_ID', '');
		vi.stubEnv('AUTH_GOOGLE_SECRET', '');
		vi.stubEnv('AUTH_GITHUB_ID', 'github-id');
		vi.stubEnv('AUTH_GITHUB_SECRET', 'github-secret');
		const { Effect, config } = await load();
		const providers = Effect.runSync(config.oauthProviders);
		expect(providers.google.enabled).toBe(false);
		expect(providers.github).toEqual({
			enabled: true,
			clientId: 'github-id',
			clientSecret: 'github-secret'
		});
	});
});
