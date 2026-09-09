import { describe, expect, it } from 'vitest';
import {
	getCapabilityRequirements,
	projectCapabilityUsability,
	resolveCapabilityConfigurations,
	resolveProfileCapabilityConfigurations,
	validateCapabilityEnvironment,
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

const LEGACY_TEST_SENTINEL_ENVIRONMENT: CapabilityEnvironment = {
	RESEND_API_KEY: 're_local_e2e_dummy',
	AUTH_EMAIL: 'noreply@e2e.example.com',
	EMAIL_ASSET_URL: 'http://localhost',
	AUTUMN_SECRET_KEY: 'am_sk_local_e2e_dummy',
	OPENROUTER_API_KEY: 'sk-or-local-e2e-dummy'
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
		['public DNS', 'https://features.example.com'],
		['hex-looking DNS label', 'https://fcatalog.example.com'],
		['trailing-dot public DNS', 'https://assets.example.com.'],
		['public IPv4', 'https://8.8.8.8'],
		['PCP anycast exception', 'https://192.0.0.9'],
		['TURN anycast exception', 'https://192.0.0.10'],
		['address beside the 6a44 anycast address', 'https://192.88.99.1'],
		['public IPv6', 'https://[2001:4860:4860::8888]'],
		['IPv4-IPv6 translation prefix', 'https://[64:ff9b::808:808]'],
		['mapped public IPv4', 'https://[::ffff:8.8.8.8]'],
		['IPv6 PCP anycast exception', 'https://[2001:1::1]'],
		['IPv6 TURN anycast exception', 'https://[2001:1::2]'],
		['IPv6 DNS-SD anycast exception', 'https://[2001:1::3]'],
		['AMT exception', 'https://[2001:3::1]'],
		['AS112-v6 exception', 'https://[2001:4:112::1]'],
		['ORCHIDv2 exception', 'https://[2001:20::1]'],
		['DETs exception', 'https://[2001:30::1]']
	])('accepts the syntactically public %s asset URL', (_description, assetUrl) => {
		expect(
			resolveCapabilityConfigurations({ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: assetUrl }).email
		).toMatchObject({ state: 'ready' });
	});

	it.each([
		['0.0.0.0/8', 'https://0.0.0.1'],
		['10.0.0.0/8', 'https://10.0.0.1'],
		['100.64.0.0/10', 'https://100.64.0.1'],
		['127.0.0.0/8', 'https://127.0.0.1'],
		['169.254.0.0/16', 'https://169.254.0.1'],
		['172.16.0.0/12', 'https://172.16.0.1'],
		['192.0.0.0/24', 'https://192.0.0.1'],
		['192.0.2.0/24', 'https://192.0.2.1'],
		['192.88.99.2/32', 'https://192.88.99.2'],
		['192.168.0.0/16', 'https://192.168.0.1'],
		['198.18.0.0/15', 'https://198.18.0.1'],
		['198.51.100.0/24', 'https://198.51.100.1'],
		['203.0.113.0/24', 'https://203.0.113.1'],
		['224.0.0.0/4', 'https://224.0.0.1'],
		['240.0.0.0/4', 'https://240.0.0.1'],
		['::/128', 'https://[::]'],
		['::1/128', 'https://[::1]'],
		['::/96', 'https://[::808:808]'],
		['::ffff:0:0/96 with private IPv4', 'https://[::ffff:10.0.0.1]'],
		['64:ff9b:1::/48', 'https://[64:ff9b:1::1]'],
		['100::/64', 'https://[100::1]'],
		['100:0:0:1::/64', 'https://[100:0:0:1::1]'],
		['2001::/23', 'https://[2001:10::1]'],
		['2001:2::/48', 'https://[2001:2::1]'],
		['2001:db8::/32', 'https://[2001:db8::1]'],
		['3fff::/20', 'https://[3fff::1]'],
		['5f00::/16', 'https://[5f00::1]'],
		['fc00::/7', 'https://[fd12::1]'],
		['fe80::/10', 'https://[fe80::1]'],
		['fec0::/10', 'https://[fec0::1]'],
		['ff00::/8', 'https://[ff02::1]']
	])('rejects the syntactically non-public %s literal', (_cidr, assetUrl) => {
		expect(
			resolveCapabilityConfigurations({ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: assetUrl }).email
		).toEqual({ state: 'misconfigured', issue: 'invalid' });
	});

	it.each([
		'alt',
		'6tisch.arpa',
		'eap.arpa',
		'eap-noob.arpa',
		'home.arpa',
		'10.in-addr.arpa',
		'254.169.in-addr.arpa',
		'16.172.in-addr.arpa',
		'17.172.in-addr.arpa',
		'18.172.in-addr.arpa',
		'19.172.in-addr.arpa',
		'20.172.in-addr.arpa',
		'21.172.in-addr.arpa',
		'22.172.in-addr.arpa',
		'23.172.in-addr.arpa',
		'24.172.in-addr.arpa',
		'25.172.in-addr.arpa',
		'26.172.in-addr.arpa',
		'27.172.in-addr.arpa',
		'28.172.in-addr.arpa',
		'29.172.in-addr.arpa',
		'30.172.in-addr.arpa',
		'31.172.in-addr.arpa',
		'170.0.0.192.in-addr.arpa',
		'171.0.0.192.in-addr.arpa',
		'168.192.in-addr.arpa',
		'8.e.f.ip6.arpa',
		'9.e.f.ip6.arpa',
		'a.e.f.ip6.arpa',
		'b.e.f.ip6.arpa',
		'ipv4only.arpa',
		'resolver.arpa',
		'service.arpa',
		'example',
		'invalid',
		'local',
		'localhost',
		'onion',
		'test'
	])('rejects the registered non-public DNS suffix %s', (suffix) => {
		const assetUrl = `https://assets.${suffix}.`;
		expect(
			resolveCapabilityConfigurations({ ...READY_ENVIRONMENT, EMAIL_ASSET_URL: assetUrl }).email
		).toEqual({ state: 'misconfigured', issue: 'invalid' });
	});

	it.each(['example.com', 'example.net', 'example.org'])(
		'keeps the public documentation host assets.%s usable',
		(suffix) => {
			expect(
				resolveCapabilityConfigurations({
					...READY_ENVIRONMENT,
					EMAIL_ASSET_URL: `https://assets.${suffix}`
				}).email
			).toMatchObject({ state: 'ready' });
		}
	);

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

describe('capability profiles', () => {
	it('keeps an absent profile as the production-strict legacy alias', () => {
		expect(getCapabilityRequirements(undefined)).toEqual({
			billing: 'required',
			email: 'required',
			ai: 'required'
		});
		expect(() => validateCapabilityEnvironment({})).toThrow(
			'[capability] billing configuration is invalid'
		);
	});

	it.each(['local', 'test'] as const)('allows providerless %s configuration', (profile) => {
		expect(resolveProfileCapabilityConfigurations({ CAPABILITY_PROFILE: profile })).toEqual({
			billing: { state: 'disabled' },
			email: { state: 'disabled' },
			ai: { state: 'disabled' }
		});
		expect(() => validateCapabilityEnvironment({ CAPABILITY_PROFILE: profile })).not.toThrow();
	});

	it.each(['local', 'test'] as const)(
		'keeps persisted test sentinels unusable without rejecting the %s definition',
		(profile) => {
			const configurations = validateCapabilityEnvironment({
				...LEGACY_TEST_SENTINEL_ENVIRONMENT,
				CAPABILITY_PROFILE: profile
			});

			expect(configurations).toEqual({
				billing: { state: 'misconfigured', issue: 'sentinel' },
				email: { state: 'misconfigured', issue: 'sentinel' },
				ai: { state: 'misconfigured', issue: 'sentinel' }
			});
			expect(projectCapabilityUsability(configurations)).toEqual({
				billing: { usable: false, reason: 'unavailable' },
				ai: { usable: false, reason: 'unavailable' }
			});
		}
	);

	it.each(['preview', 'production'] as const)('requires every provider group in %s', (profile) => {
		expect(() => validateCapabilityEnvironment({ CAPABILITY_PROFILE: profile })).toThrow();
		expect(() =>
			validateCapabilityEnvironment({ ...READY_ENVIRONMENT, CAPABILITY_PROFILE: profile })
		).not.toThrow();
	});

	it('rejects unknown profiles without reproducing their value', () => {
		expect(() =>
			validateCapabilityEnvironment({ ...READY_ENVIRONMENT, CAPABILITY_PROFILE: 'staging-secret' })
		).toThrow('[capability] CAPABILITY_PROFILE is invalid');
	});

	const missingOrBlankCases = (
		[
			'RESEND_API_KEY',
			'AUTH_EMAIL',
			'EMAIL_ASSET_URL',
			'AUTUMN_SECRET_KEY',
			'OPENROUTER_API_KEY'
		] as const
	).flatMap(
		(key) =>
			[
				[`missing ${key}`, { ...READY_ENVIRONMENT, [key]: undefined }],
				[`blank ${key}`, { ...READY_ENVIRONMENT, [key]: '   ' }]
			] as const
	);

	const invalidCases = [
		...missingOrBlankCases,
		['invalid sender', { ...READY_ENVIRONMENT, AUTH_EMAIL: 'not-an-email' }],
		['invalid asset URL', { ...READY_ENVIRONMENT, EMAIL_ASSET_URL: 'https://localhost' }],
		['email sentinel', { ...READY_ENVIRONMENT, RESEND_API_KEY: 're_local_e2e_dummy' }],
		['billing sentinel', { ...READY_ENVIRONMENT, AUTUMN_SECRET_KEY: 'am_sk_local_e2e_dummy' }],
		['AI sentinel', { ...READY_ENVIRONMENT, OPENROUTER_API_KEY: 'sk-or-local-e2e-dummy' }]
	] as const;

	it.each(['local', 'test'] as const)('admits non-ready optional providers in %s', (profile) => {
		for (const [description, environment] of invalidCases) {
			const configurations = validateCapabilityEnvironment({
				...environment,
				CAPABILITY_PROFILE: profile
			});
			expect(
				Object.values(configurations).some(({ state }) => state !== 'ready'),
				description
			).toBe(true);
		}
	});

	it.each(['preview', 'production'] as const)(
		'rejects every malformed provider case in %s',
		(profile) => {
			for (const [description, environment] of invalidCases) {
				expect(
					() => validateCapabilityEnvironment({ ...environment, CAPABILITY_PROFILE: profile }),
					description
				).toThrow();
			}
		}
	);

	it('collapses internal states into the fixed public projection', () => {
		expect(
			projectCapabilityUsability(
				resolveProfileCapabilityConfigurations({ CAPABILITY_PROFILE: 'local' })
			)
		).toEqual({
			billing: { usable: false, reason: 'unavailable' },
			ai: { usable: false, reason: 'unavailable' }
		});
		expect(
			projectCapabilityUsability(
				resolveProfileCapabilityConfigurations({
					...READY_ENVIRONMENT,
					CAPABILITY_PROFILE: 'production'
				})
			)
		).toEqual({ billing: { usable: true }, ai: { usable: true } });
	});
});
