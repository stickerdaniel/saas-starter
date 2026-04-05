import { describe, expect, it } from 'vitest';
import { applyMarkdownPatch } from './patch-cf-worker';

// Realistic worker snippet matching adapter-cloudflare@7.2.8 output
// Includes both the worktop cache lookup AND the static-serving condition
const WORKER_FIXTURE = `
    let pragma = req.headers.get("cache-control") || "";
    let res = !pragma.includes("no-cache") && await r2(req);
    if (res) return res;
    let { pathname, search } = new URL(req.url);
    let is_static_asset = false;
    const filename = stripped_pathname.slice(base_path.length + 1);
    if (filename) {
      is_static_asset = manifest.assets.has(filename) || manifest.assets.has(filename + "/index.html") || filename in manifest._.server_assets || filename + "/index.html" in manifest._.server_assets;
    }
    if (is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable)) {
      res = await env2.ASSETS.fetch(req);
    } else if (location && prerendered.has(location)) {
      res = new Response("", { status: 308, headers: { location } });
    } else {
      res = await server.respond(req, { platform: { env: env2, ctx } });
    }
`;

// Fixture without the cache lookup (fallback path)
const WORKER_FIXTURE_NO_CACHE = `
    let is_static_asset = false;
    if (is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable)) {
      res = await env2.ASSETS.fetch(req);
    }
`;

describe('patch-cf-worker', () => {
	it('patches both cache lookup and static-serving condition', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE);
		expect(result).not.toBeNull();
		expect(result).toContain('__wantsMarkdown');
	});

	it('skips worktop cache for markdown requests', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;

		// __wantsMarkdown detection should appear before the cache lookup
		const mdIndex = result.indexOf('__wantsMarkdown');
		const cacheIndex = result.indexOf('await r2(req)');
		expect(mdIndex).toBeLessThan(cacheIndex);

		// Cache lookup should be gated: !__wantsMarkdown && !pragma... && await r2(req)
		expect(result).toContain('!__wantsMarkdown && !pragma.includes("no-cache") && await r2(req)');
	});

	it('wraps ALL static-serving disjuncts without extra parens', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;

		// The patched condition must be: !__wantsMarkdown && (A || B || C || D)
		expect(result).toContain(
			'!__wantsMarkdown && (is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable))'
		);

		// Verify correct paren nesting: if(!md && (...startsWith(immutable))) {
		// Three closing parens is correct: startsWith() + wrapping group + if()
		expect(result).toContain('pathname.startsWith(immutable))) {');
		// But no quadruple parens (would indicate a regex bug)
		expect(result).not.toContain('))))');
	});

	it('preserves the else branches unchanged', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;
		expect(result).toContain('else if (location && prerendered.has(location))');
		expect(result).toContain('res = await server.respond(req');
	});

	it('returns null for unrecognized worker output', () => {
		expect(applyMarkdownPatch('console.log("hello")')).toBeNull();
	});

	it('markdown requests fall through to server.respond', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;

		// When __wantsMarkdown is true, both cache and static-serving are skipped
		expect(result).toMatch(/if\s*\(!__wantsMarkdown\s*&&\s*\(/);
	});

	it('falls back when cache pattern not found', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE_NO_CACHE);
		expect(result).not.toBeNull();
		expect(result).toContain('__wantsMarkdown');
		expect(result).toContain('!__wantsMarkdown && (is_static_asset');
	});
});
