// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defaultTreeAdapter as tree, parse, type DefaultTreeAdapterTypes } from 'parse5';
import { describe, expect, it } from 'vitest';
import {
	appTemplateScriptHashes,
	buildContentSecurityPolicy,
	deriveSentryReportUri
} from './csp.js';

// Only the initializer parity check below runs script, and only the template's own
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
		// app.html owns the reload bootstrap and the mode-watcher theme initializer.
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

describe('mode-watcher initializer copied into src/app.html', () => {
	const upstreamSource = readFileSync(
		path.resolve('node_modules/mode-watcher/dist/mode.js'),
		'utf8'
	);
	const upstreamSetInitialMode = upstreamSource.match(/function setInitialMode[\s\S]*?\n\}/)?.[0];
	// ModeWatcher's defaults, which src/routes/+layout.svelte does not override.
	const defaultConfig = {
		defaultMode: 'system',
		darkClassNames: ['dark'],
		lightClassNames: [],
		defaultTheme: '',
		modeStorageKey: 'mode-watcher-mode',
		themeStorageKey: 'mode-watcher-theme'
	};
	const copiedInitializer = parsedInlineScripts(appTemplate).find((body) =>
		body.includes('function setInitialMode')
	);

	it('tracks the upstream setInitialMode source', () => {
		expect(
			upstreamSetInitialMode,
			'setInitialMode not found in mode-watcher/dist/mode.js'
		).toBeDefined();
		expect(
			sha256(upstreamSetInitialMode!),
			"mode-watcher's setInitialMode changed upstream: port the change into the copy in src/app.html"
		).toBe('sha256-NNW8Woh/BBAB32UgnIohmp5dmS5tYyx630lkf4nITzY=');
	});

	// Root and storage state after running an initializer on a fresh document.
	function initialState(
		script: string,
		{ stored, theme, systemLight }: { stored?: string; theme?: string; systemLight: boolean }
	) {
		const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
			url: 'https://example.test/',
			runScripts: 'outside-only'
		});
		const { window } = dom;
		try {
			window.matchMedia = ((query: string) => ({
				matches: query === '(prefers-color-scheme: light)' && systemLight
			})) as unknown as typeof window.matchMedia;
			if (stored) window.localStorage.setItem('mode-watcher-mode', stored);
			if (theme) window.localStorage.setItem('mode-watcher-theme', theme);
			window.eval(script);
			const root = window.document.documentElement;
			return {
				className: root.className,
				colorScheme: root.style.colorScheme,
				dataTheme: root.getAttribute('data-theme'),
				storedMode: window.localStorage.getItem('mode-watcher-mode'),
				storedTheme: window.localStorage.getItem('mode-watcher-theme')
			};
		} finally {
			window.close();
		}
	}

	it.each([
		{ stored: 'light', systemLight: false },
		{ stored: 'dark', systemLight: true },
		{ stored: 'system', systemLight: true },
		{ stored: 'system', systemLight: false },
		{ systemLight: true },
		{ systemLight: false },
		{ stored: 'dark', theme: 'forest', systemLight: true }
	])('sets the same initial state as upstream for %o', (preferences) => {
		expect(copiedInitializer, 'no setInitialMode script in src/app.html').toBeDefined();
		const upstream = `(${upstreamSetInitialMode})(${JSON.stringify(defaultConfig)});`;
		expect(initialState(copiedInitializer!, preferences)).toEqual(
			initialState(upstream, preferences)
		);
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
		expect(scriptSrc).toContain('wasm-unsafe-eval');
		expect(csp.reportOnly?.['report-uri']).toEqual([
			'https://o123456.ingest.sentry.io/api/7890/security/?sentry_key=abc123'
		]);
	});
});
