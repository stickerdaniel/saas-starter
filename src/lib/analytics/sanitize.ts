import type { CaptureResult, Properties } from 'posthog-js';
import { reportedPath } from './routes';

/**
 * Outbound payload policy, applied to every event in `before_send`.
 *
 * The SDK copies URL data into many properties: the current, initial and
 * session-entry URL, referrer and pathname, plus campaign query values and search
 * keywords extracted into their own keys. This rewrites all of them so that only a
 * known route path (anything else becomes /404), the referring origin and bounded UTM
 * values leave the browser.
 *
 * It is data minimisation by syntax, not proof that an allowed value is harmless: a
 * campaign value that passes the pattern can still carry text someone put in a link.
 */

export interface SanitizeContext {
	/**
	 * Whether a pageview was admitted in the current identity epoch. Before that, no
	 * event may link back to a pageview from an earlier consent period or identity.
	 */
	epochHasPageview: boolean;
}

const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
/** Campaign keys the pinned SDK extracts besides UTM: ad click ids and vendor ids. */
const OTHER_CAMPAIGN_KEYS = new Set([
	'gad_source',
	'mc_cid',
	'gclid',
	'gclsrc',
	'dclid',
	'gbraid',
	'wbraid',
	'fbclid',
	'msclkid',
	'twclid',
	'li_fat_id',
	'igshid',
	'ttclid',
	'rdt_cid',
	'epik',
	'qclid',
	'sccid',
	'irclid',
	'_kx'
]);
const CAMPAIGN_PREFIXES = ['$initial_', '$session_entry_', ''];
const CAMPAIGN_VALUE = /^[A-Za-z0-9 ._+-]{1,100}$/;

function campaignBase(key: string): string | undefined {
	for (const prefix of CAMPAIGN_PREFIXES) {
		if (!key.startsWith(prefix)) continue;
		const base = key.slice(prefix.length);
		if (UTM_KEYS.has(base) || OTHER_CAMPAIGN_KEYS.has(base)) return base;
	}
	return undefined;
}

export function isAllowedCampaignValue(value: unknown): value is string {
	return typeof value === 'string' && CAMPAIGN_VALUE.test(value);
}

function parseHttpUrl(value: string): URL | undefined {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
	} catch {
		return undefined;
	}
}

/** Origin + reported path + allowed UTM params. No credentials, other params or hash. */
export function sanitizeUrl(value: string): string | undefined {
	const url = parseHttpUrl(value);
	if (!url) return undefined;
	const query = new URLSearchParams();
	for (const [name, paramValue] of url.searchParams) {
		if (UTM_KEYS.has(name) && isAllowedCampaignValue(paramValue)) query.append(name, paramValue);
	}
	const search = query.size ? `?${query}` : '';
	return `${url.origin}${reportedPath(url.pathname)}${search}`;
}

function sanitizeReferrer(value: string): string | undefined {
	if (value === '$direct') return value;
	return parseHttpUrl(value)?.origin;
}

function sanitizeProperties(properties: Properties | undefined): Properties | undefined {
	if (!properties) return properties;
	const result: Properties = {};
	for (const [key, value] of Object.entries(properties)) {
		const lower = key.toLowerCase();
		if (key === 'title' || key.includes('ph_keyword')) continue;

		const base = campaignBase(key);
		if (base) {
			if (UTM_KEYS.has(base) && isAllowedCampaignValue(value)) result[key] = value;
			continue;
		}

		if (lower.endsWith('referrer')) {
			const referrer = typeof value === 'string' ? sanitizeReferrer(value) : undefined;
			if (referrer) result[key] = referrer;
			continue;
		}
		if (lower.endsWith('url')) {
			const url = typeof value === 'string' ? sanitizeUrl(value) : undefined;
			if (url) result[key] = url;
			continue;
		}
		if (lower.endsWith('pathname')) {
			if (typeof value === 'string' && value.startsWith('/')) {
				result[key] = reportedPath(value);
			}
			continue;
		}
		result[key] = value;
	}
	return result;
}

function withoutPreviousPageview(properties: Properties): Properties {
	return Object.fromEntries(
		Object.entries(properties).filter(([key]) => !key.startsWith('$prev_pageview_'))
	);
}

export function sanitizeCaptureResult(
	event: CaptureResult,
	context: SanitizeContext
): CaptureResult {
	let properties = sanitizeProperties(event.properties) ?? {};
	properties.$set = sanitizeProperties(properties.$set as Properties | undefined);
	properties.$set_once = sanitizeProperties(properties.$set_once as Properties | undefined);
	if (properties.$set === undefined) delete properties.$set;
	if (properties.$set_once === undefined) delete properties.$set_once;

	// A new consent period or identity must not link back to pageviews from before it.
	if (!context.epochHasPageview) {
		if (event.event === '$pageview') properties = withoutPreviousPageview(properties);
		else delete properties.$pageview_id;
	}

	const result: CaptureResult = { ...event, properties };
	const $set = sanitizeProperties(event.$set);
	const $setOnce = sanitizeProperties(event.$set_once);
	if ($set) result.$set = $set;
	if ($setOnce) result.$set_once = $setOnce;
	return result;
}
