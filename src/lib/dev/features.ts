/**
 * Catalog of optional features and the env keys that gate them.
 *
 * Used by `devNotice` to format consistent dev-time warnings when a gated
 * feature degrades silently in local dev. The catalog is also designed to
 * be reusable by future boot-time diagnostics (banners, doctor scripts) —
 * keep this file free of runtime side effects so it can be imported from
 * any context, including the Vite config loader.
 *
 * **Constraints (important):**
 * No imports from `$env/*`, no Convex `_generated/*`, no Svelte runtime
 * imports. Plain TypeScript and string constants only.
 */

export type DevFeatureScope = 'convex' | 'sveltekit' | 'vite-public';

export type DevFeature = {
	/** Human-readable feature name (shown in notices and banner). */
	name: string;
	/** Where the env vars live. Determines the fix command we suggest. */
	scope: DevFeatureScope;
	/** Env var names that gate the feature (must all be set to enable it). */
	missing: readonly string[];
	/** Reference doc / example file to point developers at. */
	docs?: string;
};

export type CapabilityRequirement = 'optional' | 'required';
export type CapabilityProfile = 'local' | 'test' | 'preview' | 'production';

type ConfigurationIssue = 'blank' | 'incomplete' | 'invalid' | 'missing' | 'sentinel';

export type CapabilityConfiguration<Value> =
	| { state: 'disabled' }
	| { state: 'misconfigured'; issue: ConfigurationIssue }
	| { state: 'ready'; value: Value };

export type CapabilityEnvironment = {
	CAPABILITY_PROFILE?: string | null;
	RESEND_API_KEY?: string | null;
	AUTH_EMAIL?: string | null;
	EMAIL_ASSET_URL?: string | null;
	AUTUMN_SECRET_KEY?: string | null;
	OPENROUTER_API_KEY?: string | null;
};

export type CapabilityRequirements = {
	billing: CapabilityRequirement;
	email: CapabilityRequirement;
	ai: CapabilityRequirement;
};

export type EmailConfiguration = {
	apiKey: string;
	sender: string;
	assetUrl: string;
};

export type BillingConfiguration = { secretKey: string };
export type AiConfiguration = { apiKey: string };

export type CapabilityConfigurations = {
	billing: CapabilityConfiguration<BillingConfiguration>;
	email: CapabilityConfiguration<EmailConfiguration>;
	ai: CapabilityConfiguration<AiConfiguration>;
};

export type PublicCapabilityStatus = { usable: true } | { usable: false; reason: 'unavailable' };

export type PublicCapabilityUsability = {
	billing: PublicCapabilityStatus;
	ai: PublicCapabilityStatus;
};

export const UNAVAILABLE_CAPABILITY_USABILITY: PublicCapabilityUsability = {
	billing: { usable: false, reason: 'unavailable' },
	ai: { usable: false, reason: 'unavailable' }
};

export const STRICT_CAPABILITY_REQUIREMENTS: CapabilityRequirements = {
	billing: 'required',
	email: 'required',
	ai: 'required'
};

const OPTIONAL_CAPABILITY_REQUIREMENTS: CapabilityRequirements = {
	billing: 'optional',
	email: 'optional',
	ai: 'optional'
};

export class InvalidCapabilityProfileError extends Error {
	constructor() {
		super('[capability] CAPABILITY_PROFILE is invalid');
		this.name = 'InvalidCapabilityProfileError';
	}
}

/** Absence remains the production-strict legacy/bootstrap profile. */
export function getCapabilityRequirements(
	profile: string | null | undefined
): CapabilityRequirements {
	if (
		profile === undefined ||
		profile === null ||
		profile === 'preview' ||
		profile === 'production'
	) {
		return STRICT_CAPABILITY_REQUIREMENTS;
	}
	if (profile === 'local' || profile === 'test') return OPTIONAL_CAPABILITY_REQUIREMENTS;
	throw new InvalidCapabilityProfileError();
}

const BILLING_SENTINELS = new Set([
	'am_sk_your_secret_key_here',
	'am_sk_local_e2e_dummy',
	'placeholder-key-for-analysis'
]);
const AI_SENTINELS = new Set(['sk-or-v1-your_openrouter_api_key_here', 'sk-or-local-e2e-dummy']);
const EMAIL_SENTINELS = {
	apiKey: new Set(['re_your_api_key_here', 're_local_e2e_dummy']),
	sender: new Set(['noreply@yourdomain.com', 'noreply@e2e.example.com']),
	assetUrl: new Set(['https://yourdomain.com', 'http://localhost'])
};

function resolveSingle<Value>(
	value: string | null | undefined,
	requirement: CapabilityRequirement,
	sentinels: ReadonlySet<string>,
	map: (value: string) => Value
): CapabilityConfiguration<Value> {
	if (value === undefined || value === null) {
		return requirement === 'optional'
			? { state: 'disabled' }
			: { state: 'misconfigured', issue: 'missing' };
	}

	const normalized = value.trim();
	if (!normalized) return { state: 'misconfigured', issue: 'blank' };
	if (sentinels.has(normalized)) return { state: 'misconfigured', issue: 'sentinel' };
	return { state: 'ready', value: map(normalized) };
}

function isValidSenderEmail(value: string): boolean {
	return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

type AddressParser = (address: string) => number[] | null;

// IANA IPv4 and IPv6 Special-Purpose Address Registries, updated 2025-10-09.
// Multicast and deprecated compatible/site-local ranges remain non-public too.
const NON_GLOBAL_IPV4_CIDRS = [
	'0.0.0.0/8',
	'10.0.0.0/8',
	'100.64.0.0/10',
	'127.0.0.0/8',
	'169.254.0.0/16',
	'172.16.0.0/12',
	'192.0.0.0/24',
	'192.0.2.0/24',
	'192.88.99.2/32',
	'192.168.0.0/16',
	'198.18.0.0/15',
	'198.51.100.0/24',
	'203.0.113.0/24',
	'224.0.0.0/4',
	'240.0.0.0/4'
] as const;

const GLOBAL_IPV4_EXCEPTIONS = ['192.0.0.9/32', '192.0.0.10/32'] as const;

const NON_GLOBAL_IPV6_CIDRS = [
	'::/128',
	'::1/128',
	'::/96',
	'::ffff:0:0/96',
	'64:ff9b:1::/48',
	'100::/64',
	'100:0:0:1::/64',
	'2001::/23',
	'2001:2::/48',
	'2001:db8::/32',
	'3fff::/20',
	'5f00::/16',
	'fc00::/7',
	'fe80::/10',
	'fec0::/10',
	'ff00::/8'
] as const;

const GLOBAL_IPV6_EXCEPTIONS = [
	'2001:1::1/128',
	'2001:1::2/128',
	'2001:1::3/128',
	'2001:3::/32',
	'2001:4:112::/48',
	'2001:20::/28',
	'2001:30::/28'
] as const;

// IANA Special-Use Domain Names registry, updated 2026-05-22. The public
// documentation hosts example.com/.net/.org intentionally remain usable.
const NON_PUBLIC_DOMAIN_SUFFIXES = [
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
] as const;

function parseIpv4(hostname: string): number[] | null {
	const parts = hostname.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
	const octets = parts.map(Number);
	return octets.some((octet) => octet < 0 || octet > 255) ? null : octets;
}

function parseIpv6(hostname: string): number[] | null {
	if (!hostname.includes(':')) return null;
	const halves = hostname.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves[1] ? halves[1].split(':') : [];
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

	const segments = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
	if (segments.length !== 8 || segments.some((segment) => !/^[\da-f]{1,4}$/i.test(segment))) {
		return null;
	}
	return segments.map((segment) => Number.parseInt(segment, 16));
}

function matchesCidr(
	address: readonly number[],
	cidr: string,
	parseAddress: AddressParser,
	bitsPerPart: number
): boolean {
	const [networkAddress, prefixLengthText] = cidr.split('/');
	const network = networkAddress ? parseAddress(networkAddress) : null;
	const prefixLength = Number(prefixLengthText);
	if (!network || address.length !== network.length || !Number.isInteger(prefixLength))
		return false;
	if (prefixLength < 0 || prefixLength > address.length * bitsPerPart) return false;

	const fullParts = Math.floor(prefixLength / bitsPerPart);
	for (let index = 0; index < fullParts; index += 1) {
		if (address[index] !== network[index]) return false;
	}

	const remainingBits = prefixLength % bitsPerPart;
	if (remainingBits === 0) return true;
	const mask = 2 ** bitsPerPart - 2 ** (bitsPerPart - remainingBits);
	return (address[fullParts]! & mask) === (network[fullParts]! & mask);
}

function matchesAnyCidr(
	address: readonly number[],
	cidrs: readonly string[],
	parseAddress: AddressParser,
	bitsPerPart: number
): boolean {
	return cidrs.some((cidr) => matchesCidr(address, cidr, parseAddress, bitsPerPart));
}

function isNonGlobalIpv4(octets: readonly number[]): boolean {
	if (matchesAnyCidr(octets, GLOBAL_IPV4_EXCEPTIONS, parseIpv4, 8)) return false;
	return matchesAnyCidr(octets, NON_GLOBAL_IPV4_CIDRS, parseIpv4, 8);
}

function isNonGlobalIpv6(words: readonly number[]): boolean {
	const mappedIpv4 =
		words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
			? [words[6]! >> 8, words[6]! & 0xff, words[7]! >> 8, words[7]! & 0xff]
			: null;
	// Mapped literals inherit the reachability of their embedded IPv4 address.
	if (mappedIpv4) return isNonGlobalIpv4(mappedIpv4);
	if (matchesAnyCidr(words, GLOBAL_IPV6_EXCEPTIONS, parseIpv6, 16)) return false;
	return matchesAnyCidr(words, NON_GLOBAL_IPV6_CIDRS, parseIpv6, 16);
}

function hasDomainSuffix(hostname: string, suffix: string): boolean {
	return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

// Syntactic screening only: DNS names are never resolved here.
function isPublicAssetUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password) return false;

		const hostname = url.hostname
			.toLowerCase()
			.replace(/^\[|\]$/g, '')
			.replace(/\.+$/, '');
		if (
			!hostname ||
			NON_PUBLIC_DOMAIN_SUFFIXES.some((suffix) => hasDomainSuffix(hostname, suffix))
		) {
			return false;
		}

		const ipv4 = parseIpv4(hostname);
		if (ipv4) return !isNonGlobalIpv4(ipv4);
		const ipv6 = parseIpv6(hostname);
		if (ipv6) return !isNonGlobalIpv6(ipv6);
		return hostname.includes('.');
	} catch {
		return false;
	}
}

function resolveEmailConfiguration(
	input: CapabilityEnvironment,
	requirement: CapabilityRequirement
): CapabilityConfiguration<EmailConfiguration> {
	const rawValues = [input.RESEND_API_KEY, input.AUTH_EMAIL, input.EMAIL_ASSET_URL];
	if (rawValues.every((value) => value === undefined || value === null)) {
		return requirement === 'optional'
			? { state: 'disabled' }
			: { state: 'misconfigured', issue: 'missing' };
	}
	if (rawValues.some((value) => value === undefined || value === null)) {
		return { state: 'misconfigured', issue: 'incomplete' };
	}

	const [apiKey, sender, assetUrl] = rawValues.map((value) => value!.trim());
	if (!apiKey || !sender || !assetUrl) return { state: 'misconfigured', issue: 'blank' };
	if (
		EMAIL_SENTINELS.apiKey.has(apiKey) ||
		EMAIL_SENTINELS.sender.has(sender) ||
		EMAIL_SENTINELS.assetUrl.has(assetUrl)
	) {
		return { state: 'misconfigured', issue: 'sentinel' };
	}
	if (!isValidSenderEmail(sender) || !isPublicAssetUrl(assetUrl)) {
		return { state: 'misconfigured', issue: 'invalid' };
	}

	return { state: 'ready', value: { apiKey, sender, assetUrl } };
}

export function resolveCapabilityConfigurations(
	input: CapabilityEnvironment,
	requirements: CapabilityRequirements = STRICT_CAPABILITY_REQUIREMENTS
): CapabilityConfigurations {
	return {
		billing: resolveSingle(
			input.AUTUMN_SECRET_KEY,
			requirements.billing,
			BILLING_SENTINELS,
			(secretKey) => ({
				secretKey
			})
		),
		email: resolveEmailConfiguration(input, requirements.email),
		ai: resolveSingle(input.OPENROUTER_API_KEY, requirements.ai, AI_SENTINELS, (apiKey) => ({
			apiKey
		}))
	};
}

export function resolveProfileCapabilityConfigurations(
	input: CapabilityEnvironment
): CapabilityConfigurations {
	return resolveCapabilityConfigurations(
		input,
		getCapabilityRequirements(input.CAPABILITY_PROFILE)
	);
}

/** Reject malformed groups in every profile and missing providers in strict profiles. */
export function validateCapabilityEnvironment(
	input: CapabilityEnvironment
): CapabilityConfigurations {
	const configurations = resolveProfileCapabilityConfigurations(input);
	for (const [capability, configuration] of Object.entries(configurations)) {
		if (configuration.state === 'misconfigured') {
			throw new Error(`[capability] ${capability} configuration is invalid`);
		}
	}
	return configurations;
}

export function projectCapabilityUsability(
	configurations: CapabilityConfigurations
): PublicCapabilityUsability {
	const project = (configuration: CapabilityConfiguration<unknown>): PublicCapabilityStatus =>
		configuration.state === 'ready' ? { usable: true } : { usable: false, reason: 'unavailable' };
	return {
		billing: project(configurations.billing),
		ai: project(configurations.ai)
	};
}

export const DEV_FEATURES = [
	{
		name: 'Email delivery (Resend)',
		scope: 'convex',
		missing: ['RESEND_API_KEY', 'AUTH_EMAIL', 'EMAIL_ASSET_URL'],
		docs: '.env.convex.example'
	},
	{
		name: 'Email webhook signature verification (Resend)',
		scope: 'convex',
		missing: ['RESEND_WEBHOOK_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'Google sign-in',
		scope: 'convex',
		missing: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'GitHub sign-in',
		scope: 'convex',
		missing: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'],
		docs: '.env.convex.example'
	},
	{
		name: 'Billing (Autumn)',
		scope: 'convex',
		missing: ['AUTUMN_SECRET_KEY'],
		docs: '.env.convex.example'
	},
	{
		name: 'Product analytics (PostHog)',
		scope: 'vite-public',
		missing: ['PUBLIC_POSTHOG_API_KEY', 'PUBLIC_POSTHOG_HOST'],
		docs: '.env.schema'
	},
	{
		name: 'Error monitoring (Sentry)',
		scope: 'vite-public',
		missing: ['PUBLIC_SENTRY_DSN'],
		docs: '.env.schema'
	},
	{
		name: 'Tolgee in-context translation editing',
		scope: 'vite-public',
		missing: ['VITE_TOLGEE_API_KEY'],
		docs: '.env.schema'
	}
] as const satisfies readonly DevFeature[];

/**
 * Returns the canonical fix command for a given scope.
 *
 * `convex` keys need `bunx convex env set NAME value` against the local
 * embedded backend (or the cloud deployment). `sveltekit` and `vite-public`
 * keys are added to `.env.local`.
 */
export function fixHintFor(scope: DevFeatureScope, key: string): string {
	if (scope === 'convex') return `bunx convex env set ${key} <value>`;
	return `add ${key}=<value> to .env.local`;
}
