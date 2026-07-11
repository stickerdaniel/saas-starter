import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	APP_HTML_SCRIPT_HASH,
	MODE_WATCHER_SCRIPT_HASH,
	MODE_WATCHER_SOURCE_FINGERPRINT,
	buildContentSecurityPolicy,
	deriveSentryReportUri
} from './csp.js';

const sha256 = (content: string) =>
	'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');

// Content of an attribute-less inline <script> ... </script> block.
function firstInlineScript(html: string): string {
	const content = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
	if (content == null) throw new Error('no inline <script> block found');
	return content;
}

describe('CSP script-src hashes', () => {
	it('APP_HTML_SCRIPT_HASH matches the current src/app.html inline script', () => {
		// app.html is copied into every page verbatim, so hashing the source block
		// reproduces the deployed hash exactly. If this fails, the bootstrap script
		// changed: update APP_HTML_SCRIPT_HASH in src/lib/security/csp.js.
		const appHtml = readFileSync(path.resolve('src/app.html'), 'utf8');
		expect(sha256(firstInlineScript(appHtml))).toBe(APP_HTML_SCRIPT_HASH);
	});

	it('mode-watcher setInitialMode source is unchanged (proxy for the deployed hash)', () => {
		// MODE_WATCHER_SCRIPT_HASH is the production bundler's reformatted output of
		// mode-watcher's FOUC script, so it cannot be recomputed without a full build.
		// Instead fingerprint the setInitialMode SOURCE: a mode-watcher bump that
		// touches it fails here, signalling that MODE_WATCHER_SCRIPT_HASH must be
		// regenerated from a fresh `bun run build` (see the regeneration note below).
		const modeSource = readFileSync(path.resolve('node_modules/mode-watcher/dist/mode.js'), 'utf8');
		const fn = modeSource.match(/function setInitialMode[\s\S]*?\n\}/);
		expect(fn, 'setInitialMode not found in mode-watcher/dist/mode.js').not.toBeNull();
		expect(
			sha256(fn![0]),
			'mode-watcher FOUC script changed — rebuild and regenerate MODE_WATCHER_SCRIPT_HASH'
		).toBe(MODE_WATCHER_SOURCE_FINGERPRINT);
	});

	it('both hashes are well-formed sha256 CSP source expressions', () => {
		const format = /^sha256-[A-Za-z0-9+/]{43}=$/;
		expect(APP_HTML_SCRIPT_HASH).toMatch(format);
		expect(MODE_WATCHER_SCRIPT_HASH).toMatch(format);
	});
});

describe('deriveSentryReportUri', () => {
	it('builds a Sentry security endpoint from a DSN', () => {
		expect(deriveSentryReportUri('https://abc123@o123456.ingest.sentry.io/7890')).toBe(
			'https://o123456.ingest.sentry.io/api/7890/security/?sentry_key=abc123'
		);
	});

	it('returns null for missing or malformed DSNs', () => {
		expect(deriveSentryReportUri(undefined)).toBeNull();
		expect(deriveSentryReportUri('')).toBeNull();
		expect(deriveSentryReportUri('not-a-url')).toBeNull();
		// No public key / no project id
		expect(deriveSentryReportUri('https://o123456.ingest.sentry.io/7890')).toBeNull();
		expect(deriveSentryReportUri('https://abc123@o123456.ingest.sentry.io/')).toBeNull();
	});
});

describe('buildContentSecurityPolicy', () => {
	it('enforces object-src/base-uri and omits report-only without a Sentry DSN', () => {
		const csp = buildContentSecurityPolicy({});
		expect(csp.mode).toBe('auto');
		expect(csp.directives).toEqual({ 'object-src': ['none'], 'base-uri': ['self'] });
		// SvelteKit throws at build time on a report-only policy without report-uri,
		// so forks without Sentry must get no reportOnly block at all.
		expect(csp.reportOnly).toBeUndefined();
	});

	it('adds a report-only script-src with both hashes and the report-uri when Sentry is set', () => {
		const csp = buildContentSecurityPolicy({
			sentryDsn: 'https://abc123@o123456.ingest.sentry.io/7890'
		});
		const scriptSrc = csp.reportOnly?.['script-src'] ?? [];
		expect(scriptSrc).toContain(APP_HTML_SCRIPT_HASH);
		expect(scriptSrc).toContain(MODE_WATCHER_SCRIPT_HASH);
		expect(scriptSrc).toContain('strict-dynamic');
		expect(scriptSrc).toContain('wasm-unsafe-eval');
		expect(csp.reportOnly?.['report-uri']).toEqual([
			'https://o123456.ingest.sentry.io/api/7890/security/?sentry_key=abc123'
		]);
	});
});
