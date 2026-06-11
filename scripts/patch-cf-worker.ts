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
		return patched === source ? null : patched;
	}

	// Step 2: Also skip static asset serving for markdown requests
	patched = patched.replace(STATIC_SERVING_PATTERN, `$1!__wantsMarkdown && ($2))`);

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
