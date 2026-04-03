/**
 * Post-build patch for the Cloudflare Worker entry point.
 *
 * adapter-cloudflare's generated worker serves prerendered pages as static files
 * BEFORE calling server.respond(), which bypasses SvelteKit hooks. This breaks
 * the Accept: text/markdown content negotiation for marketing routes (used by
 * /llms.txt and AI agents).
 *
 * This script patches the worker to check the Accept header and fall through to
 * server.respond() for markdown requests, preserving same-URL content negotiation.
 *
 * Only runs when WORKERS_CI is set (i.e., Cloudflare Workers builds).
 * On Vercel (adapter-auto), server.respond() always runs — no patch needed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKER_PATH = path.resolve('.svelte-kit/cloudflare/_worker.js');

if (!fs.existsSync(WORKER_PATH)) {
	// Not a Cloudflare build (e.g., Vercel via adapter-auto) — nothing to patch
	console.log('[patch-cf-worker] No worker file found — skipping (not a CF build).');
	process.exit(0);
}

const original = fs.readFileSync(WORKER_PATH, 'utf-8');

// The worker has this pattern (may be minified):
//   if (is_static_asset || prerendered.has(pathname) || ...)
//     res = await env2.ASSETS.fetch(req);
//
// We need to add: && !wantsMarkdown  to skip static serving for markdown requests.

// Match the entire if-condition that gates static asset / prerendered serving.
// Captures everything between `if (` and the closing `)` before `{` or newline.
// The condition includes: is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable)
// We must wrap ALL disjuncts, not just the first two, to avoid `(!md && (A||B)) || C` precedence bugs.
const PATTERN = /(if\s*\()(is_static_asset\s*\|\|[^)]+prerendered\.has\(pathname\)[^)]*)\)/;

if (!PATTERN.test(original)) {
	console.error(
		'[patch-cf-worker] Could not find the static-serving condition in the worker. ' +
			'The adapter-cloudflare output may have changed. Skipping patch.'
	);
	process.exit(1);
}

const patched = original.replace(
	PATTERN,
	`const __wantsMarkdown = /\\btext\\/markdown\\b/i.test(req.headers.get("accept") || "");\n$1!__wantsMarkdown && ($2))`
);

if (patched === original) {
	console.error('[patch-cf-worker] Patch had no effect. Skipping.');
	process.exit(1);
}

fs.writeFileSync(WORKER_PATH, patched, 'utf-8');
console.log('[patch-cf-worker] Patched worker for Accept: text/markdown passthrough.');
