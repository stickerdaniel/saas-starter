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

type ConfigurationIssue = 'blank' | 'incomplete' | 'invalid' | 'missing' | 'sentinel';

export type CapabilityConfiguration<Value> =
	| { state: 'disabled' }
	| { state: 'misconfigured'; issue: ConfigurationIssue }
	| { state: 'ready'; value: Value };

export type CapabilityEnvironment = {
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

export const STRICT_CAPABILITY_REQUIREMENTS: CapabilityRequirements = {
	billing: 'required',
	email: 'required',
	ai: 'required'
};

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

function parseIpv4(hostname: string): number[] | null {
	const parts = hostname.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
	const octets = parts.map(Number);
	return octets.some((octet) => octet < 0 || octet > 255) ? null : octets;
}

function isNonGlobalIpv4(octets: readonly number[]): boolean {
	const [first, second, third, fourth] = octets;
	return (
		first === 0 ||
		first === 10 ||
		(first === 100 && second !== undefined && second >= 64 && second <= 127) ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second !== undefined && second >= 16 && second <= 31) ||
		(first === 192 &&
			second === 0 &&
			((third === 0 && fourth !== 9 && fourth !== 10) || third === 2)) ||
		(first === 192 && second === 88 && third === 99 && fourth !== 2) ||
		(first === 192 && second === 168) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113) ||
		(first !== undefined && first >= 224)
	);
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

function isNonGlobalIpv6(words: readonly number[]): boolean {
	const [first, second] = words;
	const unspecified = words.every((word) => word === 0);
	const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
	const uniqueLocal = first !== undefined && (first & 0xfe00) === 0xfc00;
	const localPrefix = first === undefined ? undefined : first & 0xffc0;
	const linkOrSiteLocal = localPrefix === 0xfe80 || localPrefix === 0xfec0;
	const multicast = first !== undefined && (first & 0xff00) === 0xff00;
	const documentation =
		(first === 0x2001 && second === 0x0db8) ||
		(first === 0x3fff && second !== undefined && (second & 0xf000) === 0);
	const mappedIpv4 =
		words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
			? [words[6]! >> 8, words[6]! & 0xff, words[7]! >> 8, words[7]! & 0xff]
			: null;
	const compatibleIpv4 = words.slice(0, 6).every((word) => word === 0);

	return (
		unspecified ||
		loopback ||
		compatibleIpv4 ||
		uniqueLocal ||
		linkOrSiteLocal ||
		multicast ||
		documentation ||
		(mappedIpv4 !== null && isNonGlobalIpv4(mappedIpv4))
	);
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
			hostname === 'localhost' ||
			hostname.endsWith('.localhost') ||
			hostname === 'local' ||
			hostname.endsWith('.local')
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
