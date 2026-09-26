// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ownedScriptHashProblems, type RenderedPage } from './csp-hashes';

const sha256Source = (content: string) =>
	`sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;

const bootstrapBody = '\n\t\t\t(() => { window.__deployReloadArmed = true; })();\n\t\t';
const modeBody = '(function setInitialMode({ defaultMode = "system" } = {}) {})({});';
const owned = {
	APP_HTML_SCRIPT_HASH: sha256Source(bootstrapBody),
	MODE_WATCHER_SCRIPT_HASH: sha256Source(modeBody)
};

const page = (html: string, overrides: Partial<RenderedPage> = {}): RenderedPage => ({
	status: 200,
	contentType: 'text/html',
	html,
	...overrides
});

const htmlDocument = (...scripts: string[]) =>
	`<!doctype html><html><head>${scripts.join('')}</head><body></body></html>`;

describe('ownedScriptHashProblems', () => {
	it('accepts a page that emits every owned script among framework scripts', () => {
		const html = htmlDocument(
			`<script>${bootstrapBody}</script>`,
			`<script>${modeBody}</script>`,
			'<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
			'<script type="module" src="/_app/immutable/entry/start.js"></script>',
			'<script>\n\t{ __sveltekit_x = { base: new URL(".", location).pathname.slice(0, -1) }; }\n</script>'
		);

		expect(ownedScriptHashProblems(page(html), owned)).toEqual([]);
	});

	it('names only the constant whose emitted script body changed', () => {
		const html = htmlDocument(
			`<script>${bootstrapBody}</script>`,
			`<script>${modeBody.replace('"system"', '"dark"')}</script>`
		);

		const problems = ownedScriptHashProblems(page(html), owned);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('MODE_WATCHER_SCRIPT_HASH');
	});

	it('names the constant whose script the page no longer emits', () => {
		const problems = ownedScriptHashProblems(
			page(htmlDocument(`<script>${modeBody}</script>`)),
			owned
		);

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('APP_HTML_SCRIPT_HASH');
	});

	it('finds owned scripts that carry attributes', () => {
		const html = htmlDocument(
			`<script nonce="r4nd0m">${bootstrapBody}</script>`,
			`<script data-mode-watcher>${modeBody}</script>`
		);

		expect(ownedScriptHashProblems(page(html), owned)).toEqual([]);
	});

	it('fails closed on a page without scripts', () => {
		const problems = ownedScriptHashProblems(page(''), owned);

		expect(problems.join('\n')).toContain('APP_HTML_SCRIPT_HASH');
		expect(problems.join('\n')).toContain('MODE_WATCHER_SCRIPT_HASH');
	});

	it.each([
		{ status: 500, contentType: 'text/html' },
		{ status: 307, contentType: null },
		{ status: 200, contentType: 'text/markdown; charset=utf-8' }
	])('fails closed on a $status $contentType response', (response) => {
		const html = htmlDocument(`<script>${bootstrapBody}</script>`, `<script>${modeBody}</script>`);

		expect(ownedScriptHashProblems(page(html, response), owned)).toEqual([
			expect.stringContaining(`got ${response.status}`)
		]);
	});
});
