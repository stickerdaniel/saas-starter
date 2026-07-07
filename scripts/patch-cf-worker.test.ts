import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
	applyMarkdownPatch,
	applyVersionedCacheKeyPatch,
	findVersionFile
} from './patch-cf-worker';

// Realistic worker snippet matching adapter-cloudflare@7.2.8 output
// Includes the worktop cache lookup, the static-serving condition, AND the
// tail return that saves the response to the edge cache
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
    pragma = res.headers.get("cache-control") || "";
    return pragma && res.status < 400 ? c(req, res, ctx) : res;
`;

// Fixture without the cache lookup (fallback path)
const WORKER_FIXTURE_NO_CACHE = `
    let is_static_asset = false;
    if (is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable)) {
      res = await env2.ASSETS.fetch(req);
    }
`;

// Fixture where the worktop cache call drifted to take extra args, so
// CACHE_LOOKUP_PATTERN no longer matches but a cache lookup clearly exists
const WORKER_FIXTURE_DRIFTED_CACHE = `
    let pragma = req.headers.get("cache-control") || "";
    let res = !pragma.includes("no-cache") && await r2(req, opts);
    if (res) return res;
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

	it('throws when a cache lookup exists but the pattern drifted', () => {
		expect(() => applyMarkdownPatch(WORKER_FIXTURE_DRIFTED_CACHE)).toThrow(
			/CACHE_LOOKUP_PATTERN did not match/
		);
	});

	it('adds s-maxage edge cache to prerendered marketing HTML', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;
		expect(result).toContain('s-maxage=3600, stale-while-revalidate=86400');
		expect(result).toMatch(/!__wantsMarkdown && prerendered\.has\(pathname\)/);
		expect(result).toContain('res = new Response(res.body, res)');
		expect(result.match(/s-maxage=3600/g)?.length).toBe(1);
		expect(result.match(/const __wantsMarkdown =/g)?.length).toBe(1);
	});

	it('forces browser revalidation of prerendered marketing HTML', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;
		// Browser must revalidate the shell so it never boots a stale version
		// referencing deleted chunk hashes after a deploy.
		expect(result).toContain(
			'public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400'
		);
	});

	it('does not add a public cache header to the server.respond branch', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;
		const elseIdx = result.indexOf('res = await server.respond(req');
		expect(result.slice(elseIdx)).not.toContain('s-maxage');
	});

	it('injects the marketing edge-cache on the no-cache fallback path', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE_NO_CACHE)!;
		expect(result).toContain(
			'public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400'
		);
		expect(result).toContain('res = new Response(res.body, res)');
		expect(result.match(/s-maxage=3600/g)?.length).toBe(1);
	});
});

describe('applyVersionedCacheKeyPatch', () => {
	it('salts both lookup and save with the same versioned key', () => {
		const result = applyVersionedCacheKeyPatch(WORKER_FIXTURE, 'abc123')!;

		expect(result).toContain('!pragma.includes("no-cache") && await r2(__cacheKey)');
		expect(result).toContain('? c(__cacheKey, res, ctx) : res;');
		// The bare-req call sites must be gone, or lookup and save diverge
		expect(result).not.toContain('await r2(req)');
		expect(result).not.toContain('c(req, res, ctx)');
	});

	it('embeds the deployment version in the key', () => {
		const result = applyVersionedCacheKeyPatch(WORKER_FIXTURE, 'abc123')!;
		// append, not set: a client-supplied __v param must not collapse into the
		// clean URL's cache entry
		expect(result).toContain('__cacheKeyUrl.searchParams.append("__v", "abc123")');
	});

	it('throws on a missing or empty version instead of salting with "undefined"', () => {
		expect(() =>
			applyVersionedCacheKeyPatch(WORKER_FIXTURE, undefined as unknown as string)
		).toThrow(/non-empty version/);
		expect(() => applyVersionedCacheKeyPatch(WORKER_FIXTURE, '')).toThrow(/non-empty version/);
	});

	it('declares the key before the lookup so both call sites share it', () => {
		const result = applyVersionedCacheKeyPatch(WORKER_FIXTURE, 'abc123')!;
		const declIdx = result.indexOf('const __cacheKey = new Request(__cacheKeyUrl, req);');
		const lookupIdx = result.indexOf('await r2(__cacheKey)');
		const saveIdx = result.indexOf('c(__cacheKey, res, ctx)');
		expect(declIdx).toBeGreaterThan(-1);
		expect(declIdx).toBeLessThan(lookupIdx);
		expect(lookupIdx).toBeLessThan(saveIdx);
	});

	it('composes with applyMarkdownPatch (markdown first, the CLI order)', () => {
		const md = applyMarkdownPatch(WORKER_FIXTURE)!;
		const result = applyVersionedCacheKeyPatch(md, 'abc123')!;

		expect(result).toContain(
			'!__wantsMarkdown && !pragma.includes("no-cache") && await r2(__cacheKey)'
		);
		expect(result).toContain('? c(__cacheKey, res, ctx) : res;');
		expect(result.match(/const __cacheKey =/g)?.length).toBe(1);
	});

	it('returns null when the worker has no worktop cache layer', () => {
		expect(applyVersionedCacheKeyPatch(WORKER_FIXTURE_NO_CACHE, 'abc123')).toBeNull();
	});

	it('throws when only one of lookup/save matches (half-salted cache)', () => {
		const lookupOnly = WORKER_FIXTURE.replace('? c(req, res, ctx) : res;', '? res : res;');
		expect(() => applyVersionedCacheKeyPatch(lookupOnly, 'abc123')).toThrow(/half-salted/i);

		const saveOnly = WORKER_FIXTURE.replace(
			'!pragma.includes("no-cache") && await r2(req)',
			'await r2(req, opts)'
		);
		expect(() => applyVersionedCacheKeyPatch(saveOnly, 'abc123')).toThrow(/half-salted/i);
	});

	it('does not touch ASSETS.fetch or server.respond call sites', () => {
		const result = applyVersionedCacheKeyPatch(WORKER_FIXTURE, 'abc123')!;
		expect(result).toContain('res = await env2.ASSETS.fetch(req);');
		expect(result).toContain('res = await server.respond(req');
	});

	it('applies cleanly to the real adapter worker template', () => {
		// Guard against adapter upgrades drifting the patterns: patch the actual
		// template the installed adapter bundles into _worker.js. Fails here in
		// unit tests instead of failing the CI build (or worse, silently
		// disabling the edge cache).
		const require = createRequire(import.meta.url);
		const templatePath = require
			.resolve('@sveltejs/adapter-cloudflare/package.json')
			.replace(/package\.json$/, 'files/worker.js');
		const template = fs.readFileSync(templatePath, 'utf-8');

		const md = applyMarkdownPatch(template);
		expect(md).not.toBeNull();

		const result = applyVersionedCacheKeyPatch(md!, 'abc123');
		expect(result).not.toBeNull();
		expect(result).toContain('await r2(__cacheKey)');
		expect(result).toContain('? c(__cacheKey, res, ctx) : res;');
		expect(result).toContain('__cacheKeyUrl.searchParams.append("__v", "abc123")');
	});
});

describe('findVersionFile', () => {
	it('locates version.json under a non-default appDir and skips decoys', () => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-cf-worker-'));
		try {
			// Decoy: a user-provided static/version.json copied to the output root
			// (no immutable/ sibling)
			fs.writeFileSync(path.join(outDir, 'version.json'), '{"version":"decoy"}');
			// Decoy: prerendered page directory
			fs.mkdirSync(path.join(outDir, 'en'));
			fs.writeFileSync(path.join(outDir, 'en', 'index.html'), '<html></html>');
			// The real app dir, renamed via kit.appDir
			fs.mkdirSync(path.join(outDir, 'custom-app', 'immutable'), { recursive: true });
			fs.writeFileSync(path.join(outDir, 'custom-app', 'version.json'), '{"version":"abc"}');

			expect(findVersionFile(outDir)).toBe(path.join(outDir, 'custom-app', 'version.json'));
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
		}
	});

	it('returns null when no app dir exists', () => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-cf-worker-'));
		try {
			expect(findVersionFile(outDir)).toBeNull();
		} finally {
			fs.rmSync(outDir, { recursive: true, force: true });
		}
	});
});
