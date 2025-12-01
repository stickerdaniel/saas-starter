/**
 * SnapDOM Configuration Utility
 *
 * Manages CORS proxy configuration for screenshot capture with snapDOM.
 *
 * Strategy:
 * - Development: Always use public proxy (corsproxy.io) for quick testing
 * - Production: Use custom Cloudflare Worker if provided via env var (optional)
 *
 * See docs/screenshot-proxy-setup.md for Cloudflare Worker setup instructions.
 */

import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

/**
 * Get the CORS proxy URL for snapDOM
 *
 * Development automatically uses a public proxy for convenience.
 * Production uses a custom proxy only if explicitly configured.
 *
 * @returns Proxy URL string or undefined (no proxy)
 */
export function getSnapDOMProxyUrl(): string | undefined {
	if (dev) {
		// Development: Always use public proxy for quick testing
		// This is safe for dev because screenshots are local-only
		return 'https://corsproxy.io/?';
	}

	// Production: Use custom Cloudflare Worker proxy if provided
	// Falls back to no proxy if not configured (external images may fail with CORS)
	return env.PUBLIC_SNAPDOM_PROXY_URL || undefined;
}

/**
 * Get configuration for snapdom() capture function
 *
 * Returns optimized configuration for screenshot capture including:
 * - CORS proxy (dev: public, prod: custom or none)
 * - Font embedding enabled
 * - Full caching for performance
 * - Fast mode for immediate captures
 *
 * @returns snapDOM configuration object for snapdom()
 */
export function getSnapDOMConfig() {
	const useProxy = getSnapDOMProxyUrl();

	return {
		useProxy,
		embedFonts: true,
		cache: 'full' as const,
		fast: true
	};
}

/**
 * Get configuration for preCache() function
 *
 * Returns optimized configuration for resource preloading including:
 * - CORS proxy (dev: public, prod: custom or none)
 * - Font embedding enabled
 * - Full caching for performance
 *
 * Note: preCache uses 'cacheOpt' instead of 'cache' (snapDOM API quirk)
 *
 * @returns snapDOM configuration object for preCache()
 */
export function getPreCacheConfig() {
	const useProxy = getSnapDOMProxyUrl();

	return {
		useProxy,
		embedFonts: true,
		cacheOpt: 'full' as const
	};
}
