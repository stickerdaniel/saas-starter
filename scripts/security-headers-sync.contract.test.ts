import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Security headers are defined in THREE places that must stay in sync:
 * 1. _headers file (project root) — for static/prerendered assets served by CF Workers
 * 2. hooks.server.ts handleSecurityHeaders — for SSR responses
 * 3. vercel.json headers[] — for static assets served by Vercel (the _headers
 *    file is CF/Netlify-only, so without this Vercel static assets get none)
 *
 * If one is updated without the others, some responses will be missing headers.
 *
 * Content-Security-Policy is the one header not fully expressed here: script-src/
 * object-src/base-uri live in the SvelteKit csp option (vite.config.ts), so all three
 * sources below carry only the header-only frame-ancestors directive. On SSR the hook
 * appends it to the CSP header SvelteKit already set (a merge, not an overwrite),
 * so it is matched via its fallback literal rather than a plain set().
 */

function parseHeadersFile(content: string): Map<string, string> {
	const headers = new Map<string, string>();

	let inGlobalBlock = false;
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		// Path patterns start a new block. Only the global "/*" block carries the
		// security headers; per-path blocks (e.g. /fonts/*) hold cache rules only.
		if (trimmed.startsWith('/')) {
			inGlobalBlock = trimmed === '/*';
			continue;
		}
		if (!inGlobalBlock) continue;
		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) continue;
		const name = trimmed.slice(0, colonIndex).trim().toLowerCase();
		const value = trimmed.slice(colonIndex + 1).trim();
		headers.set(name, value);
	}

	return headers;
}

function parseHooksHeaders(content: string): Map<string, string> {
	const headers = new Map<string, string>();

	// Match: response.headers.set('Header-Name', 'value' | "value")
	// The value can be single- or double-quoted (the CSP value contains single
	// quotes, so it is written as a double-quoted JS string) and may span
	// multiple lines via Prettier's argument wrapping.
	const pattern = /response\.headers\.set\(\s*['"]([^'"]+)['"]\s*,\s*(?:'([^']+)'|"([^"]+)")\s*\)/g;
	let match;
	while ((match = pattern.exec(content)) !== null) {
		const name = match[1]!.toLowerCase();
		const value = (match[2] ?? match[3])!;
		// Skip Cache-Control and Vary — those are route-specific, not security headers
		if (name === 'cache-control' || name === 'vary') continue;
		headers.set(name, value);
	}

	// CSP is set via a merge (frame-ancestors is appended to the header SvelteKit
	// already set from the csp option) rather than a plain literal, so the generic pattern
	// above does not catch it. Match its fallback value — the same frame-ancestors
	// directive it appends and guarantees on every response.
	// The fallback is written as a double-quoted JS string because its value
	// contains single quotes (frame-ancestors 'none').
	const csp = content.match(
		/headers\.set\(\s*['"]Content-Security-Policy['"]\s*,[\s\S]*?:\s*"([^"]+)"\s*\)/
	);
	if (csp) headers.set('content-security-policy', csp[1]!);

	return headers;
}

function parseVercelHeaders(content: string): Map<string, string> {
	const config = JSON.parse(content) as {
		headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
	};
	const headers = new Map<string, string>();

	const globalBlock = config.headers?.find((entry) => entry.source === '/(.*)');
	for (const { key, value } of globalBlock?.headers ?? []) {
		headers.set(key.toLowerCase(), value);
	}

	return headers;
}

// Canonical security header set; every source must carry exactly these.
const EXPECTED = new Map<string, string>([
	['x-content-type-options', 'nosniff'],
	['x-frame-options', 'DENY'],
	['referrer-policy', 'strict-origin-when-cross-origin'],
	[
		'permissions-policy',
		'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), serial=()'
	],
	['x-dns-prefetch-control', 'off'],
	['strict-transport-security', 'max-age=63072000; includeSubDomains'],
	['content-security-policy', "frame-ancestors 'none'"],
	['cross-origin-opener-policy', 'same-origin-allow-popups'],
	['cross-origin-resource-policy', 'same-origin']
]);

interface HeaderSources {
	_headers: string;
	'hooks.server.ts': string;
	'vercel.json': string;
}

/** Every header on which the three sources disagree with the canonical set or each other. */
function headerMismatches(sources: HeaderSources): string[] {
	const parsed = {
		_headers: parseHeadersFile(sources['_headers']),
		'hooks.server.ts': parseHooksHeaders(sources['hooks.server.ts']),
		'vercel.json': parseVercelHeaders(sources['vercel.json'])
	};
	const mismatches: string[] = [];
	for (const [source, headers] of Object.entries(parsed)) {
		for (const [name, value] of EXPECTED) {
			if (headers.get(name) !== value) mismatches.push(`${source} missing/mismatched "${name}"`);
		}
		// No source may carry a security header the others lack.
		for (const [name, value] of headers) {
			for (const [other, otherHeaders] of Object.entries(parsed)) {
				if (otherHeaders.get(name) !== value) {
					mismatches.push(`${source} has "${name}: ${value}" but ${other} does not`);
				}
			}
		}
	}
	return mismatches;
}

describe('security headers sync', () => {
	const sources: HeaderSources = {
		_headers: fs.readFileSync(path.resolve('_headers'), 'utf-8'),
		'hooks.server.ts': fs.readFileSync(path.resolve('src/hooks.server.ts'), 'utf-8'),
		'vercel.json': fs.readFileSync(path.resolve('vercel.json'), 'utf-8')
	};

	it('_headers, hooks.server.ts, and vercel.json define the same security headers', () => {
		expect(headerMismatches(sources)).toEqual([]);
	});

	it('rejects a hook that sends a different frame policy', () => {
		const hooks = sources['hooks.server.ts'].replace(
			"'X-Frame-Options', 'DENY'",
			"'X-Frame-Options', 'SAMEORIGIN'"
		);
		expect(hooks).not.toBe(sources['hooks.server.ts']);
		expect(headerMismatches({ ...sources, 'hooks.server.ts': hooks })).toContain(
			'hooks.server.ts missing/mismatched "x-frame-options"'
		);
	});
});
