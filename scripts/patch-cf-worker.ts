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

// Core of the worktop cache lookup call, shared by CACHE_LOOKUP_PATTERN and
// CACHE_KEY_LOOKUP_PATTERN so adapter drift is fixed in one place.
const WORKTOP_LOOKUP_CORE = /!pragma\.includes\("no-cache"\) && await /.source;

// Match the worktop cache lookup: `let res = !pragma.includes("no-cache") && await r2(req);`
// We inject the __wantsMarkdown check here so markdown requests bypass the cache entirely.
// CF Cache API ignores Vary headers, so cached HTML would be served for markdown requests.
export const CACHE_LOOKUP_PATTERN = new RegExp(`(let res = )(${WORKTOP_LOOKUP_CORE}\\w+\\(req\\))`);

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

// Match the worktop cache lookup call so its `req` argument can be swapped for
// a versioned cache key. Anchored on the `!pragma.includes("no-cache") &&`
// prefix so `env2.ASSETS.fetch(req)` and `server.respond(req, ...)` can never
// match. Tolerates the `!__wantsMarkdown && ` prefix applyMarkdownPatch
// prepends. Order matters: run applyMarkdownPatch FIRST (as the CLI does).
// Reversed, its patterns expect the bare `(req)` argument, miss the salted
// call, and silently skip the markdown cache bypass.
export const CACHE_KEY_LOOKUP_PATTERN = new RegExp(`(${WORKTOP_LOOKUP_CORE})(\\w+)\\(req\\)`);

// Match the tail save call `c(req, res, ctx)` in the worker's single return.
export const CACHE_KEY_SAVE_PATTERN = /(\? )(\w+)\(req, (res, ctx\))/;

/**
 * Salt the worktop cache key with the deployment version (issue #651).
 *
 * The worktop layer caches responses per colo keyed on the bare URL. Branch
 * alias and workers.dev URLs stay constant across deploys, so after a push a
 * colo keeps serving the previous build's marketing HTML for up to
 * s-maxage=3600 while its immutable chunk hashes 404 on the new deployment:
 * the page never hydrates. workers.dev cannot purge, so the stale copy can
 * only age out. Keying lookup AND save on `?__v=<version>` gives every deploy
 * a cold cache namespace; old entries expire unreferenced.
 *
 * Returns the patched source, null when the worker has no worktop cache layer
 * (nothing to salt), and throws when only one of the two call sites matches:
 * a half-salted cache never hits (save and lookup use different keys), which
 * would silently disable edge caching entirely.
 */
export function applyVersionedCacheKeyPatch(source: string, version: string): string | null {
	// A missing version must fail the build, not ship: JSON.stringify(undefined)
	// would interpolate the literal text `undefined`, salting every deploy with
	// the same constant and silently reintroducing the stale-cache bug.
	if (typeof version !== 'string' || version.length === 0) {
		throw new Error(
			`applyVersionedCacheKeyPatch needs a non-empty version string, got ${JSON.stringify(version)}. ` +
				'Check the version.json read in the CLI entry point.'
		);
	}

	const hasLookup = CACHE_KEY_LOOKUP_PATTERN.test(source);
	const hasSave = CACHE_KEY_SAVE_PATTERN.test(source);
	if (!hasLookup && !hasSave) {
		return null;
	}
	if (!hasLookup || !hasSave) {
		throw new Error(
			`Found the worktop cache ${hasLookup ? 'lookup' : 'save'} but not the ` +
				`${hasLookup ? 'save' : 'lookup'} call. A half-salted cache key means ` +
				'save and lookup never agree, silently disabling the edge cache. ' +
				'Update CACHE_KEY_LOOKUP_PATTERN / CACHE_KEY_SAVE_PATTERN to match ' +
				'the new adapter output.'
		);
	}

	// Build the key once, right before the lookup, so lookup and save share it.
	// new Request(url, req) preserves the method, keeping worktop's HEAD->GET
	// cache-key normalization intact. The salted request is only ever used as a
	// Cache API key; it is never fetched. append, not set: set would overwrite a
	// client-supplied __v param and collapse /page?__v=x and /page into one
	// cache entry; append keeps the original-URL-to-key mapping injective.
	const keyConst =
		`const __cacheKeyUrl = new URL(req.url);\n` +
		`    __cacheKeyUrl.searchParams.append("__v", ${JSON.stringify(version)});\n` +
		`    const __cacheKey = new Request(__cacheKeyUrl, req);\n    `;

	let patched = source.replace(CACHE_KEY_LOOKUP_PATTERN, `$1$2(__cacheKey)`);
	patched = patched.replace(CACHE_KEY_SAVE_PATTERN, `$1$2(__cacheKey, $3`);

	// Anchor the key declaration on the pragma read that immediately precedes
	// the lookup, so __cacheKey is in scope for both call sites.
	const PRAGMA_ANCHOR = /let pragma = req\.headers\.get\("cache-control"\) \|\| "";/;
	if (!PRAGMA_ANCHOR.test(patched)) {
		throw new Error(
			'Found the worktop cache calls but not the pragma read to anchor the ' +
				'__cacheKey declaration on. Update the anchor in applyVersionedCacheKeyPatch.'
		);
	}
	patched = patched.replace(PRAGMA_ANCHOR, (m) => `${keyConst}${m}`);

	return patched;
}

/**
 * Locate SvelteKit's version.json in the built output without assuming the
 * default appDir: forks may set kit.appDir, which moves the file to
 * <appDir>/version.json. The app dir is the one directory that contains both
 * version.json and immutable/, which disambiguates it from a user-provided
 * static/version.json (copied to the output root, no immutable/ sibling).
 */
export function findVersionFile(outDir: string): string | null {
	const stack = [outDir];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		const names = new Set(entries.map((entry) => entry.name));
		if (names.has('version.json') && names.has('immutable')) {
			return path.join(dir, 'version.json');
		}
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name !== 'immutable') {
				stack.push(path.join(dir, entry.name));
			}
		}
	}
	return null;
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

	// Salt the worktop cache key with the deployment version (issue #651).
	// version.json carries the deterministic per-commit version from
	// svelte.config.js, so every deploy starts with a cold edge-cache namespace
	// instead of serving the previous build's HTML with dead chunk hashes.
	try {
		const versionPath = findVersionFile(path.resolve('.svelte-kit/cloudflare'));
		if (versionPath === null) {
			throw new Error(
				'Could not locate version.json in .svelte-kit/cloudflare. Without it the ' +
					'edge cache key cannot be salted and stale HTML with dead chunk hashes ' +
					'would be served after deploys (issue #651).'
			);
		}
		const version: string = JSON.parse(fs.readFileSync(versionPath, 'utf-8')).version;
		const versioned = applyVersionedCacheKeyPatch(patched, version);
		if (versioned === null) {
			console.log('[patch-cf-worker] No worktop cache layer found — cache key left unsalted.');
		} else {
			patched = versioned;
			console.log(`[patch-cf-worker] Salted the edge cache key with version ${version}.`);
		}
	} catch (err) {
		console.error(`[patch-cf-worker] ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	fs.writeFileSync(WORKER_PATH, patched, 'utf-8');
	console.log('[patch-cf-worker] Patched worker for Accept: text/markdown passthrough.');
}
