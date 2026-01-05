/**
 * SnapDOM Cloudflare Worker Proxy
 *
 * This worker acts as a CORS proxy for external images in screenshot captures.
 * It allows snapDOM to fetch cross-origin images that would otherwise be blocked by CORS policies.
 *
 * Security Features:
 * - Domain whitelisting to prevent proxy abuse
 * - Origin restrictions to limit who can use the proxy
 * - File size limits to prevent bandwidth abuse
 * - Automatic caching for performance
 *
 * Setup Instructions:
 * See docs/screenshot-proxy-setup.md for complete deployment guide
 */

// ====================================
// Configuration
// ====================================

/**
 * Allowed domains that can be proxied
 * Add domains you trust here to prevent proxy abuse
 */
const ALLOWED_DOMAINS = [
	'html.tailus.io', // Example: Tailus UI assets
	'images.unsplash.com', // Example: Unsplash images
	'cdn.example.com' // Add your trusted domains here
];

/**
 * Allowed origins that can use this proxy
 * Set to your production domain(s) to prevent unauthorized use
 * Use ['*'] to allow all origins (not recommended for production)
 */
const ALLOWED_ORIGINS = [
	'https://yourdomain.com', // Your production domain
	'https://www.yourdomain.com', // Your www domain
	'http://localhost:5173', // Local development (remove in production)
	'http://localhost:4173' // Local preview (remove in production)
];

/**
 * Maximum file size in bytes (10MB default)
 * Prevents bandwidth abuse and excessive costs
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Cache duration in seconds (1 day default)
 * Cloudflare will cache successful responses at the edge
 */
const CACHE_DURATION = 86400; // 24 hours

// ====================================
// Helper Functions
// ====================================

/**
 * Check if domain is whitelisted
 */
function isDomainAllowed(hostname) {
	return ALLOWED_DOMAINS.some((domain) => {
		// Exact match or subdomain match
		return hostname === domain || hostname.endsWith(`.${domain}`);
	});
}

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin) {
	if (!origin) return false;
	return ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
}

/**
 * Get CORS headers for response
 */
function getCorsHeaders(request) {
	const origin = request.headers.get('Origin');
	const headers = new Headers();

	if (isOriginAllowed(origin)) {
		headers.set('Access-Control-Allow-Origin', origin);
	} else {
		headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || '*');
	}

	headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type');
	headers.set('Access-Control-Max-Age', '86400');

	return headers;
}

// ====================================
// Main Request Handler
// ====================================

/**
 * Handle incoming requests
 */
async function handleRequest(request) {
	const url = new URL(request.url);

	// Get target URL from query parameter
	const targetUrl = url.searchParams.get('url');

	if (!targetUrl) {
		return new Response('Missing url parameter. Usage: ?url=https://example.com/image.jpg', {
			status: 400,
			headers: getCorsHeaders(request)
		});
	}

	// Parse and validate target URL
	let target;
	try {
		target = new URL(targetUrl);
	} catch (error) {
		return new Response('Invalid URL format', {
			status: 400,
			headers: getCorsHeaders(request)
		});
	}

	// Check if domain is whitelisted
	if (!isDomainAllowed(target.hostname)) {
		return new Response(`Domain not allowed: ${target.hostname}`, {
			status: 403,
			headers: getCorsHeaders(request)
		});
	}

	// Fetch the resource
	try {
		const response = await fetch(target.toString(), {
			headers: {
				'User-Agent': 'SnapDOM-Proxy/1.0',
				// Forward some original headers
				Accept: request.headers.get('Accept') || 'image/*'
			}
		});

		// Check if request was successful
		if (!response.ok) {
			return new Response(`Failed to fetch resource: ${response.status} ${response.statusText}`, {
				status: response.status,
				headers: getCorsHeaders(request)
			});
		}

		// Check content length
		const contentLength = response.headers.get('Content-Length');
		if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
			return new Response(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, {
				status: 413,
				headers: getCorsHeaders(request)
			});
		}

		// Create new response with CORS headers
		const newResponse = new Response(response.body, response);

		// Add CORS headers
		const corsHeaders = getCorsHeaders(request);
		corsHeaders.forEach((value, key) => {
			newResponse.headers.set(key, value);
		});

		// Set cache headers
		newResponse.headers.set('Cache-Control', `public, max-age=${CACHE_DURATION}`);

		// Remove sensitive headers
		newResponse.headers.delete('Set-Cookie');

		return newResponse;
	} catch (error) {
		return new Response(`Proxy error: ${error.message}`, {
			status: 502,
			headers: getCorsHeaders(request)
		});
	}
}

/**
 * Handle OPTIONS requests (CORS preflight)
 */
function handleOptions(request) {
	return new Response(null, {
		status: 204,
		headers: getCorsHeaders(request)
	});
}

// ====================================
// Cloudflare Worker Entrypoint
// ====================================

export default {
	async fetch(request, env, ctx) {
		// Handle OPTIONS request (CORS preflight)
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}

		// Only allow GET and HEAD requests
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method not allowed', {
				status: 405,
				headers: getCorsHeaders(request)
			});
		}

		// Handle the request
		return handleRequest(request);
	}
};
