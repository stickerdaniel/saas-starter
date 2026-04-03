import { describe, expect, it } from 'vitest';
import { applyMarkdownPatch } from './patch-cf-worker';

// Realistic worker snippet matching adapter-cloudflare@7.2.8 output
const WORKER_FIXTURE = `
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

describe('patch-cf-worker', () => {
	it('patches the static-serving condition', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE);
		expect(result).not.toBeNull();
		expect(result).toContain('__wantsMarkdown');
	});

	it('wraps ALL disjuncts, not just the first two', () => {
		const result = applyMarkdownPatch(WORKER_FIXTURE)!;

		// The patched condition must be: !__wantsMarkdown && (A || B || C || D)
		// NOT: (!__wantsMarkdown && (A || B)) || C || D
		expect(result).toContain(
			'!__wantsMarkdown && (is_static_asset || prerendered.has(pathname) || pathname === version_file || pathname.startsWith(immutable))'
		);
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

		// Simulate: __wantsMarkdown is true → condition is false → hits else branch
		// The patched if-condition starts with !__wantsMarkdown &&
		// When __wantsMarkdown is true, the entire condition short-circuits to false
		expect(result).toMatch(/if\s*\(!__wantsMarkdown\s*&&\s*\(/);
	});
});
