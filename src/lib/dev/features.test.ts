import { describe, expect, it } from 'vitest';
import {
	resolveCapabilityConfigurations,
	type CapabilityEnvironment,
	type CapabilityRequirements
} from './features';

const OPTIONAL_REQUIREMENTS: CapabilityRequirements = {
	billing: 'optional',
	email: 'optional',
	ai: 'optional'
};

const READY_ENVIRONMENT: CapabilityEnvironment = {
	RESEND_API_KEY: 'resend-key',
	AUTH_EMAIL: 'noreply@example.com',
	EMAIL_ASSET_URL: 'https://assets.example.com',
	AUTUMN_SECRET_KEY: 'autumn-key',
	OPENROUTER_API_KEY: 'openrouter-key'
};

describe('resolveCapabilityConfigurations', () => {
	it('keeps absent optional providers distinct from required misconfiguration', () => {
		expect(resolveCapabilityConfigurations({}, OPTIONAL_REQUIREMENTS)).toEqual({
			billing: { state: 'disabled' },
			email: { state: 'disabled' },
			ai: { state: 'disabled' }
		});
		expect(resolveCapabilityConfigurations({})).toEqual({
			billing: { state: 'misconfigured', issue: 'missing' },
			email: { state: 'misconfigured', issue: 'missing' },
			ai: { state: 'misconfigured', issue: 'missing' }
		});
	});

	it('normalizes structurally ready provider values without provider-specific key rules', () => {
		expect(
			resolveCapabilityConfigurations({
				RESEND_API_KEY: ' r ',
				AUTH_EMAIL: ' sender@example.com ',
				EMAIL_ASSET_URL: ' https://assets.example.com/email ',
				AUTUMN_SECRET_KEY: ' a ',
				OPENROUTER_API_KEY: ' o '
			})
		).toEqual({
			billing: { state: 'ready', value: { secretKey: 'a' } },
			email: {
				state: 'ready',
				value: {
					apiKey: 'r',
					sender: 'sender@example.com',
					assetUrl: 'https://assets.example.com/email'
				}
			},
			ai: { state: 'ready', value: { apiKey: 'o' } }
		});
	});

	it.each([
		[{ ...READY_ENVIRONMENT, AUTUMN_SECRET_KEY: '   ' }, 'billing', 'blank'],
		[{ ...READY_ENVIRONMENT, OPENROUTER_API_KEY: '\t' }, 'ai', 'blank'],
		[{ ...READY_ENVIRONMENT, AUTH_EMAIL: undefined }, 'email', 'incomplete'],
		[{ ...READY_ENVIRONMENT, AUTH_EMAIL: 'not-an-email' }, 'email', 'invalid'],
		[{ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: 'http://assets.example.com' }, 'email', 'invalid'],
		[{ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: 'https://localhost/assets' }, 'email', 'invalid'],
		[{ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: 'https://192.168.1.2/assets' }, 'email', 'invalid']
	] as const)('marks narrow structural failures as misconfigured', (input, capability, issue) => {
		expect(resolveCapabilityConfigurations(input)[capability]).toEqual({
			state: 'misconfigured',
			issue
		});
	});

	it.each([
		['RESEND_API_KEY', 're_your_api_key_here', 'email'],
		['RESEND_API_KEY', 're_local_e2e_dummy', 'email'],
		['AUTH_EMAIL', 'noreply@yourdomain.com', 'email'],
		['AUTH_EMAIL', 'noreply@e2e.example.com', 'email'],
		['EMAIL_ASSET_URL', 'https://yourdomain.com', 'email'],
		['EMAIL_ASSET_URL', 'http://localhost', 'email'],
		['AUTUMN_SECRET_KEY', 'am_sk_your_secret_key_here', 'billing'],
		['AUTUMN_SECRET_KEY', 'am_sk_local_e2e_dummy', 'billing'],
		['AUTUMN_SECRET_KEY', 'placeholder-key-for-analysis', 'billing'],
		['OPENROUTER_API_KEY', 'sk-or-v1-your_openrouter_api_key_here', 'ai'],
		['OPENROUTER_API_KEY', 'sk-or-local-e2e-dummy', 'ai']
	] as const)('rejects the exact known sentinel in %s', (key, value, capability) => {
		const resolved = resolveCapabilityConfigurations({ ...READY_ENVIRONMENT, [key]: value });
		expect(resolved[capability]).toEqual({ state: 'misconfigured', issue: 'sentinel' });
	});
});
