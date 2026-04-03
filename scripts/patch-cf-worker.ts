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
 * Runs as postbuild for all builds. Skips gracefully when no worker file exists
 * (e.g., Vercel via adapter-auto where server.respond() always runs).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Match the entire if-condition that gates static asset / prerendered serving.
// The condition includes: is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable)
// We must wrap ALL disjuncts to avoid `(!md && (A||B)) || C` precedence bugs.
export const STATIC_SERVING_PATTERN =
	/(if\s*\()(is_static_asset\s*\|\|[^)]+prerendered\.has\(pathname\)[^)]*)\)/;

/**
 * Apply the markdown passthrough patch to a worker source string.
 * Returns the patched source, or null if the pattern wasn't found.
 */
export function applyMarkdownPatch(source: string): string | null {
	if (!STATIC_SERVING_PATTERN.test(source)) {
		return null;
	}

	const patched = source.replace(
		STATIC_SERVING_PATTERN,
		`const __wantsMarkdown = /\\btext\\/markdown\\b/i.test(req.headers.get("accept") || "");\n$1!__wantsMarkdown && ($2))`
	);

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
	const patched = applyMarkdownPatch(original);

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
