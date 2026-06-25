/**
 * Post-build patch for the Cloudflare Worker entry point.
 *
 * Two issues with adapter-cloudflare's generated worker:
 *
 * 1. Prerendered pages are served as static files BEFORE calling server.respond(),
 *    bypassing SvelteKit hooks. This breaks Accept: text/markdown negotiation.
 *
 * 2. The worktop cache layer ignores the Vary header (CF Cache API limitation),
 *    so a cached HTML response is served for markdown requests on non-prerendered
 *    pages like /en/pricing.
 *
 * This script patches the worker to:
 * a) Detect markdown requests early (before cache lookup)
 * b) Skip the worktop cache for markdown requests
 * c) Skip static asset serving for markdown requests
 * d) Inject an s-maxage edge-cache header for prerendered marketing HTML.
 *    Those pages are served as static assets and bypass SvelteKit hooks, so
 *    they ship with no Cache-Control. This mirrors the handleCacheControl hook
 *    that caches the SSR /pricing route, leaving the markdown variant private.
 *
 * Runs as postbuild for all builds. Skips gracefully when no worker file exists
 * (e.g., Vercel via adapter-auto where server.respond() always runs).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Match the entire if-condition body that gates static asset / prerendered serving.
// The condition includes nested parens (e.g., prerendered.has(pathname), pathname.startsWith(immutable)),
// so we match from `if (` up to the `) {` that closes the if-condition.
export const STATIC_SERVING_PATTERN = /(if\s*\()(is_static_asset\b.+?\.startsWith\(immutable\))\)/;

// Match the worktop cache lookup: `let res = !pragma.includes("no-cache") && await r2(req);`
// We inject the __wantsMarkdown check here so markdown requests bypass the cache entirely.
// CF Cache API ignores Vary headers, so cached HTML would be served for markdown requests.
export const CACHE_LOOKUP_PATTERN =
	/(let res = )(!pragma\.includes\("no-cache"\) && await \w+\(req\))/;

// Match the static-asset serving call: `res = await env2.ASSETS.fetch(req);`
// We append the marketing edge-cache injection right after it, capturing the
// minified env binding (e.g. `env2`) so the replacement references the real name.
export const ASSET_SERVE_PATTERN = /res = await (\w+)\.ASSETS\.fetch\(req\);?/;

// Injection appended after the ASSETS.fetch call. `$1` is replaced with the
// captured env binding. Double-gated on the same __wantsMarkdown const used by
// the markdown passthrough so the markdown variant stays private, plus the
// prerendered set and a marketing-route regex (pricing is intentionally absent,
// it is SSR via handleCacheControl, not prerendered).
const MARKETING_HTML_CACHE_INJECTION = `res = await $1.ASSETS.fetch(req);
        if (!__wantsMarkdown && prerendered.has(pathname) && /^\\/[a-z]{2}(\\/(about|privacy|terms|impressum))?$/.test(pathname)) {
          // Prerendered marketing HTML bypasses SvelteKit hooks on CF, so it ships
          // with no Cache-Control. Apply the same policy handleCacheControl gives the
          // SSR /pricing route. ASSETS responses have immutable headers, so
          // reconstruct to mutate. max-age=0, must-revalidate asks the browser to
          // revalidate the shell so the location.href recovery in the root layout
          // fetches a fresh one instead of a stale shell with dead chunk hashes.
          // Necessary but not sufficient: a fixed zone Browser Cache TTL (default 4h)
          // is a floor that CF uses to rewrite the browser-facing max-age back up to
          // 14400 while the response stays edge-cacheable. The zone must set Browser
          // Cache TTL to "Respect Existing Headers" (or a Cache Rule on the marketing
          // HTML paths) for max-age=0 to survive. This string must stay identical to
          // handleCacheControl in src/hooks.server.ts.
          res = new Response(res.body, res);
          res.headers.set("Cache-Control", "public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400");
        }`;

/**
 * Apply the markdown passthrough patch to a worker source string.
 * Returns the patched source, or null if the pattern wasn't found.
 * Throws when a cache-like lookup exists but CACHE_LOOKUP_PATTERN no longer
 * matches it (pattern drift), so a build with lost cache-bypass fails loud.
 */
export function applyMarkdownPatch(source: string): string | null {
	if (!STATIC_SERVING_PATTERN.test(source)) {
		return null;
	}

	// Step 1: Inject __wantsMarkdown detection before the cache lookup and skip cache
	let patched = source;

	if (CACHE_LOOKUP_PATTERN.test(patched)) {
		patched = patched.replace(
			CACHE_LOOKUP_PATTERN,
			`const __wantsMarkdown = /\\btext\\/markdown\\b/i.test(req.headers.get("accept") || "");\n$1!__wantsMarkdown && $2`
		);
		// Step 2: Also skip static asset serving for markdown requests
		patched = patched.replace(STATIC_SERVING_PATTERN, `$1!__wantsMarkdown && ($2))`);
	} else {
		// Fail loud if cache-like code exists but didn't match (pattern drift).
		// \w+ excludes dotted calls like server.respond(req, ...), so this only
		// fires for worktop-style cache lookups (e.g. `await r2(req, opts)`).
		if (/await \w+\(req\b/.test(patched)) {
			throw new Error(
				'Detected a worktop cache lookup but CACHE_LOOKUP_PATTERN did not match. ' +
					'Without the cache bypass, cached HTML is served for Accept: text/markdown ' +
					'requests on non-prerendered pages. ' +
					'Update CACHE_LOOKUP_PATTERN to match the new adapter output.'
			);
		}
		// Fallback: inject before static serving (prerendered pages still fixed, no cache layer to bypass)
		patched = patched.replace(
			STATIC_SERVING_PATTERN,
			`const __wantsMarkdown = /\\btext\\/markdown\\b/i.test(req.headers.get("accept") || "");\n$1!__wantsMarkdown && ($2))`
		);
	}

	// Step 3: Inject an s-maxage edge-cache header for prerendered marketing HTML.
	// Runs in both the cache and no-cache paths (single tail return). Reuses the
	// same __wantsMarkdown const so the markdown variant stays private.
	if (ASSET_SERVE_PATTERN.test(patched)) {
		const before = patched;
		patched = patched.replace(ASSET_SERVE_PATTERN, (_m, envName) =>
			MARKETING_HTML_CACHE_INJECTION.replace('$1', envName)
		);
		if (patched === before) {
			throw new Error(
				'ASSET_SERVE_PATTERN matched but the marketing edge-cache injection did not apply.'
			);
		}
	}

	return patched === source ? null : patched;
}

// --- CLI entry point (skipped when imported for testing) ---
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
	const WORKER_PATH = path.resolve('.svelte-kit/cloudflare/_worker.js');

	if (!fs.existsSync(WORKER_PATH)) {
		console.log('[patch-cf-worker] No worker file found — skipping (not a CF build).');
		process.exit(0);
	}

	const original = fs.readFileSync(WORKER_PATH, 'utf-8');
	let patched: string | null;
	try {
		patched = applyMarkdownPatch(original);
	} catch (err) {
		console.error(`[patch-cf-worker] ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	if (patched === null) {
		console.error(
			'[patch-cf-worker] Could not find the static-serving condition in the worker. ' +
				'The adapter-cloudflare output may have changed. ' +
				'Without this patch, prerendered marketing pages lose Accept: text/markdown support.'
		);
		process.exit(1);
	}

	fs.writeFileSync(WORKER_PATH, patched, 'utf-8');
	console.log('[patch-cf-worker] Patched worker for Accept: text/markdown passthrough.');
}
