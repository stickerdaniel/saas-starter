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
 */

function parseHeadersFile(filePath: string): Map<string, string> {
	const content = fs.readFileSync(filePath, 'utf-8');
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

function parseHooksHeaders(filePath: string): Map<string, string> {
	const content = fs.readFileSync(filePath, 'utf-8');
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

	return headers;
}

function parseVercelHeaders(filePath: string): Map<string, string> {
	const content = fs.readFileSync(filePath, 'utf-8');
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

describe('security headers sync', () => {
	const headersFilePath = path.resolve('_headers');
	const hooksFilePath = path.resolve('src/hooks.server.ts');
	const vercelFilePath = path.resolve('vercel.json');

	// Canonical security header set — every source below must carry exactly these.
	const expected = new Map<string, string>([
		['x-content-type-options', 'nosniff'],
		['x-frame-options', 'DENY'],
		['referrer-policy', 'strict-origin-when-cross-origin'],
		[
			'permissions-policy',
			'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), serial=()'
		],
		['x-dns-prefetch-control', 'off'],
		['strict-transport-security', 'max-age=63072000; includeSubDomains'],
		['content-security-policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
		['cross-origin-opener-policy', 'same-origin-allow-popups'],
		['cross-origin-resource-policy', 'same-origin']
	]);

	it('_headers, hooks.server.ts, and vercel.json define the same security headers', () => {
		const fileHeaders = parseHeadersFile(headersFilePath);
		const hookHeaders = parseHooksHeaders(hooksFilePath);
		const vercelHeaders = parseVercelHeaders(vercelFilePath);

		for (const [name, value] of expected) {
			expect(fileHeaders.get(name), `_headers missing/mismatched "${name}"`).toBe(value);
			expect(hookHeaders.get(name), `hooks.server.ts missing/mismatched "${name}"`).toBe(value);
			expect(vercelHeaders.get(name), `vercel.json missing/mismatched "${name}"`).toBe(value);
		}

		// No source may carry a security header the others lack.
		for (const [name, value] of fileHeaders) {
			expect(
				hookHeaders.get(name),
				`_headers has "${name}: ${value}" but hooks.server.ts does not`
			).toBe(value);
			expect(
				vercelHeaders.get(name),
				`_headers has "${name}: ${value}" but vercel.json does not`
			).toBe(value);
		}
		for (const [name, value] of hookHeaders) {
			expect(
				fileHeaders.get(name),
				`hooks.server.ts has "${name}: ${value}" but _headers does not`
			).toBe(value);
			expect(
				vercelHeaders.get(name),
				`hooks.server.ts has "${name}: ${value}" but vercel.json does not`
			).toBe(value);
		}
		for (const [name, value] of vercelHeaders) {
			expect(
				fileHeaders.get(name),
				`vercel.json has "${name}: ${value}" but _headers does not`
			).toBe(value);
			expect(
				hookHeaders.get(name),
				`vercel.json has "${name}: ${value}" but hooks.server.ts does not`
			).toBe(value);
		}
	});
});
