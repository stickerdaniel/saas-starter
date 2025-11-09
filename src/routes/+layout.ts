// src/routes/+layout.ts
import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_API_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import { env } from '$env/dynamic/public';
import type { LayoutLoad } from './$types';

/**
 * Initialize PostHog with smart fallback strategy
 *
 * 1. Try direct PostHog access first (no proxy costs)
 * 2. If blocked by ad blocker, fall back to Cloudflare Worker proxy
 *
 * This reduces Cloudflare Worker costs while maintaining full analytics coverage.
 */
async function initializePostHog(fetch: typeof window.fetch) {
	if (!PUBLIC_POSTHOG_API_KEY) {
		console.warn('PostHog API key not configured');
		return;
	}

	let apiHost = PUBLIC_POSTHOG_HOST;

	// Get optional proxy host from dynamic env (won't throw if undefined)
	const proxyHost = env.PUBLIC_POSTHOG_PROXY_HOST;

	// Try to reach PostHog directly (Twillot's approach with GET instead of HEAD)
	// GET requests are blocked by ad blockers, HEAD requests are often allowed through
	try {
		await fetch(`${PUBLIC_POSTHOG_HOST}/static/array.js`, {
			method: 'GET',
			mode: 'no-cors'
		});
		// Direct access works
		apiHost = PUBLIC_POSTHOG_HOST;
	} catch (error) {
		// Direct access blocked, use proxy if available
		apiHost = proxyHost || PUBLIC_POSTHOG_HOST;
	}

	// Initialize PostHog
	posthog.init(PUBLIC_POSTHOG_API_KEY, {
		api_host: apiHost,
		ui_host: 'https://eu.posthog.com',
		person_profiles: 'identified_only'
	});
}

export const load: LayoutLoad = async ({ data, fetch }) => {
	if (browser) {
		await initializePostHog(fetch);
	}

	// Pass through server data (authState, autumnState)
	return data;
};
