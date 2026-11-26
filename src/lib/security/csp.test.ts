// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defaultTreeAdapter as tree, parse, type DefaultTreeAdapterTypes } from 'parse5';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
	appTemplateScriptHashes,
	buildContentSecurityPolicy,
	deriveSentryReportUri
} from './csp.js';

// Only the theme initializer check below runs script, and only the template's own
// initializer on a blank document.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (
		html: string,
		options?: { url?: string; runScripts?: 'outside-only' }
	) => { window: Window & typeof globalThis };
};

const appTemplate = readFileSync(path.resolve('src/app.html'), 'utf8');
const SENTRY_DSN = 'https://abc123@o123456.ingest.sentry.io/7890';

const sha256 = (content: string) =>
	'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');

// Inline script text as a script-enabled browser parses it, independent of the
// extractor under test: <noscript> content is raw text there, and <template>
// content is a separate fragment the walk never enters. Nothing is executed.
function parsedInlineScripts(html: string): string[] {
	const bodies: string[] = [];
	const visit = (node: DefaultTreeAdapterTypes.Node) => {
		if ('tagName' in node && node.tagName === 'script') {
			if (!node.attrs.some((attribute) => attribute.name === 'src')) {
				bodies.push(
					node.childNodes.map((child) => (tree.isTextNode(child) ? child.value : '')).join('')
				);
			}
		}
		if ('childNodes' in node) node.childNodes.forEach(visit);
	};
	visit(parse(html, { scriptingEnabled: true }));
	return bodies;
}

const policyScriptHashes = (template: string) =>
	(
		buildContentSecurityPolicy({ sentryDsn: SENTRY_DSN, appTemplate: template }).reportOnly?.[
			'script-src'
		] ?? []
	).filter((source) => source.startsWith('sha256-'));

describe('CSP script-src hashes', () => {
	it('report-only script-src allows exactly the inline scripts of src/app.html', () => {
		// app.html owns the reload bootstrap and the theme initializer.
		const bodies = parsedInlineScripts(appTemplate);
		expect(bodies, 'src/app.html should own exactly two inline scripts').toHaveLength(2);
		expect(policyScriptHashes(appTemplate).toSorted()).toEqual(bodies.map(sha256).toSorted());
	});

	it('hashes complete script bodies without trimming and deduplicates them', () => {
		const html = '<script>\n\tfirst();\n</script><p>x</p><SCRIPT >\n\tfirst();\n</SCRIPT >';
		expect(appTemplateScriptHashes(html)).toEqual([sha256('\n\tfirst();\n')]);
		expect(appTemplateScriptHashes(html)).toEqual([
			...new Set(parsedInlineScripts(html).map(sha256))
		]);
	});

	it('accepts placeholders outside script bodies', () => {
		const html =
			'<html lang="%lang%"><link href="%sveltekit.assets%/a.css" /><script>go();</script>%sveltekit.head%</html>';
		expect(appTemplateScriptHashes(html)).toEqual([sha256('go();')]);
	});

	it.each([
		['an attributed inline script', '<script type="module">go();</script>', /attributes/],
		[
			'a nonce placeholder attribute',
			'<script nonce="%sveltekit.nonce%">go();</script>',
			/attributes/
		],
		['an external script', '<script src="/app.js"></script>', /attributes/],
		[
			'a script inside a comment',
			'<!-- <script>old();</script> --><script>go();</script>',
			/inside an HTML comment/
		],
		[
			'a script inside head noscript',
			'<head><noscript><script>go();</script></noscript></head>',
			/inside <noscript>/
		],
		[
			'a script inside body noscript',
			'<body><noscript><script>go();</script></noscript></body>',
			/inside <noscript>/
		],
		[
			'a script inside template content',
			'<template><script>go();</script></template>',
			/inside <template>/
		],
		['a script inside style', '<style><script>go();</script></style>', /inside <style>/],
		[
			'a script inside textarea',
			'<textarea><script>go();</script></textarea>',
			/inside <textarea>/
		],
		[
			'a script inside a quoted attribute',
			'<div data-example="<script>go();</script>"></div>',
			/inside an attribute value/
		],
		['an SVG script', '<svg><script>go();</script></svg>', /outside the HTML namespace/],
		[
			'a script tag hidden in a script body',
			'<script>x = "<!-- <script>";</script>go();</script>',
			/does not parse as an inline script/
		],
		['a CRLF body', '<script>\r\n\tgo();\r\n</script>', /CR character/],
		['a bare CR body', '<script>go();\rstop();</script>', /CR character/],
		['a U+0000 body', '<script>go("\0");</script>', /U\+0000/],
		[
			'an assets placeholder in a body',
			'<script>go("%sveltekit.assets%");</script>',
			/placeholder/
		],
		['a lang placeholder in a body', '<script>go("%lang%");</script>', /placeholder/],
		['an unterminated script', '<script>go();', /unterminated <script>/]
	])('rejects %s instead of dropping or mis-hashing it', (_shape, html, message) => {
		// Both builds must fail, so a template shape cannot hide on Sentry-free forks.
		expect(() => buildContentSecurityPolicy({ appTemplate: html })).toThrow(message);
		expect(() => buildContentSecurityPolicy({ sentryDsn: SENTRY_DSN, appTemplate: html })).toThrow(
			message
		);
	});

	it('refuses to build a policy without the app template', () => {
		for (const appTemplate of [undefined, ''] as unknown as string[]) {
			expect(() => buildContentSecurityPolicy({ sentryDsn: SENTRY_DSN, appTemplate })).toThrow(
				/src\/app\.html/
			);
			expect(() => buildContentSecurityPolicy({ appTemplate })).toThrow(/src\/app\.html/);
		}
	});
});

describe('theme initializer in src/app.html', () => {
	const initializer = parsedInlineScripts(appTemplate).find((body) =>
		body.includes('mode-watcher-mode')
	);

	function initialRoot(stored: string | undefined, systemLight: boolean) {
		const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
			url: 'https://example.test/',
			runScripts: 'outside-only'
		});
		const { window } = dom;
		try {
			window.matchMedia = ((query: string) => ({
				matches: query === '(prefers-color-scheme: light)' && systemLight
			})) as unknown as typeof window.matchMedia;
			if (stored !== undefined) window.localStorage.setItem('mode-watcher-mode', stored);
			window.eval(initializer!);
			const root = window.document.documentElement;
			return {
				className: root.className,
				colorScheme: root.style.colorScheme,
				storedMode: window.localStorage.getItem('mode-watcher-mode')
			};
		} finally {
			window.close();
		}
	}

	// The outcomes of mode-watcher 1.1.0's setInitialMode with this app's config.
	it.each([
		{ stored: 'light', systemLight: false, scheme: 'light', storedMode: 'light' },
		{ stored: 'dark', systemLight: true, scheme: 'dark', storedMode: 'dark' },
		{ stored: 'system', systemLight: true, scheme: 'light', storedMode: 'system' },
		{ stored: 'system', systemLight: false, scheme: 'dark', storedMode: 'system' },
		{ stored: undefined, systemLight: true, scheme: 'light', storedMode: 'system' },
		{ stored: undefined, systemLight: false, scheme: 'dark', storedMode: 'system' },
		{ stored: 'sepia', systemLight: true, scheme: 'dark', storedMode: 'sepia' },
		{ stored: '', systemLight: true, scheme: 'dark', storedMode: '' }
	] as const)(
		'applies the $scheme theme for stored mode $stored with a light system $systemLight',
		({ stored, systemLight, scheme, storedMode }) => {
			expect(initializer, 'no theme initializer script in src/app.html').toBeDefined();
			expect(initialRoot(stored, systemLight)).toEqual({
				className: scheme === 'dark' ? 'dark' : '',
				colorScheme: scheme,
				storedMode
			});
		}
	);
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
		const csp = buildContentSecurityPolicy({ appTemplate });
		expect(csp.mode).toBe('auto');
		expect(csp.directives).toEqual({ 'object-src': ['none'], 'base-uri': ['self'] });
		// SvelteKit throws at build time on a report-only policy without report-uri,
		// so forks without Sentry must get no reportOnly block at all.
		expect(csp.reportOnly).toBeUndefined();
	});

	it('adds a report-only script-src with the template hashes and the report-uri when Sentry is set', () => {
		const csp = buildContentSecurityPolicy({ sentryDsn: SENTRY_DSN, appTemplate });
		const scriptSrc = csp.reportOnly?.['script-src'] ?? [];
		expect(scriptSrc).toEqual(expect.arrayContaining(appTemplateScriptHashes(appTemplate)));
		expect(scriptSrc).toContain('strict-dynamic');
		expect(csp.reportOnly?.['report-uri']).toEqual([
			'https://o123456.ingest.sentry.io/api/7890/security/?sentry_key=abc123'
		]);
	});

	it('report-only script-src-attr allows the load and error handlers Svelte writes on the server', () => {
		// Svelte writes them on load/error elements with spread props, such as
		// bits-ui's Avatar.Image, so hydration can replay a load that finished first.
		const { js } = compile('<script>let props = $props();</script><img {...props} />', {
			generate: 'server'
		});
		const handlers = [...js.code.matchAll(/ on(?:load|error)="([^"]+)"/g)].flatMap(([, body]) =>
			body ? [body] : []
		);
		expect(handlers).toHaveLength(2);
		const scriptSrcAttr =
			buildContentSecurityPolicy({ sentryDsn: SENTRY_DSN, appTemplate }).reportOnly?.[
				'script-src-attr'
			] ?? [];
		expect(scriptSrcAttr).toContain('unsafe-hashes');
		for (const handler of handlers) expect(scriptSrcAttr).toContain(sha256(handler));
	});
});
