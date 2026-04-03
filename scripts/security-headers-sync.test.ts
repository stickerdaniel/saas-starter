import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Security headers are defined in TWO places that must stay in sync:
 * 1. _headers file (project root) — for static/prerendered assets served by CF Workers
 * 2. hooks.server.ts handleSecurityHeaders — for SSR responses
 *
 * If one is updated without the other, some responses will be missing headers.
 */

function parseHeadersFile(filePath: string): Map<string, string> {
	const content = fs.readFileSync(filePath, 'utf-8');
	const headers = new Map<string, string>();

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		// Skip path patterns (e.g., /*) and empty lines
		if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('#')) continue;
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

	// Match: response.headers.set('Header-Name', 'value')
	const pattern = /response\.headers\.set\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
	let match;
	while ((match = pattern.exec(content)) !== null) {
		const name = match[1]!.toLowerCase();
		const value = match[2]!;
		// Skip Cache-Control and Vary — those are route-specific, not security headers
		if (name === 'cache-control' || name === 'vary') continue;
		headers.set(name, value);
	}

	return headers;
}

describe('security headers sync', () => {
	const headersFilePath = path.resolve('_headers');
	const hooksFilePath = path.resolve('src/hooks.server.ts');

	it('_headers file and hooks.server.ts define the same security headers', () => {
		const fileHeaders = parseHeadersFile(headersFilePath);
		const hookHeaders = parseHooksHeaders(hooksFilePath);

		// Every header in _headers must also be in hooks
		for (const [name, value] of fileHeaders) {
			expect(
				hookHeaders.get(name),
				`_headers has "${name}: ${value}" but hooks.server.ts does not`
			).toBe(value);
		}

		// Every security header in hooks must also be in _headers
		for (const [name, value] of hookHeaders) {
			expect(
				fileHeaders.get(name),
				`hooks.server.ts has "${name}: ${value}" but _headers does not`
			).toBe(value);
		}
	});
});
