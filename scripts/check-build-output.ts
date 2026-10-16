/**
 * Post-build checks on SvelteKit's prerendered output, for every adapter.
 *
 * Every supported adapter serves prerendered files before SvelteKit hooks run, so a
 * prerendered marketing page silently loses what the hooks add to it: the Markdown
 * variant for `Accept: text/markdown`, the failed-verification message, and the
 * revalidating cache policy. Those routes must stay server-rendered.
 *
 * Prerendering without `paths.origin` renders absolute URLs against SvelteKit's
 * placeholder origin, which would ship to visitors and crawlers as broken links.
 *
 * A client stylesheet that reaches the inline threshold is linked instead of
 * inlined, silently. That only costs first paint, so it warns without failing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUPPORTED_LANGUAGE_CODES } from '../src/lib/i18n/language-codes.generated.js';
import { PUBLIC_MARKETING_ROUTES } from '../src/lib/marketing/public-routes';
import { INLINE_STYLE_THRESHOLD } from './inline-styles';

export function findPrerenderOriginPlaceholders(outDir: string): string[] {
	if (!fs.existsSync(outDir)) return [];
	const matches: string[] = [];
	const stack = [outDir];
	while (stack.length > 0) {
		const current = stack.pop()!;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const entryPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (/\.(?:html|txt|xml)$/.test(entry.name)) {
				const source = fs.readFileSync(entryPath, 'utf-8');
				if (source.includes('http://sveltekit-prerender')) matches.push(entryPath);
			}
		}
	}
	return matches;
}

export function findPrerenderedNegotiatedMarketingPages(outDir: string): string[] {
	const matches: string[] = [];
	for (const language of SUPPORTED_LANGUAGE_CODES) {
		for (const route of PUBLIC_MARKETING_ROUTES) {
			const relative = `${language}${route.pathSuffix}`;
			for (const candidate of [`${relative}.html`, path.join(relative, 'index.html')]) {
				const file = path.join(outDir, candidate);
				if (fs.existsSync(file)) matches.push(file);
			}
		}
	}
	return matches;
}

/**
 * Bundled client stylesheets SvelteKit links instead of inlining, with their length.
 * Only stylesheets in Vite's client manifest qualify; CSS copied from `static/` is
 * always linked, whatever the threshold.
 */
export function findLinkedStylesheets(
	clientDir: string,
	threshold: number
): Array<{ file: string; length: number }> {
	const manifestPath = path.join(clientDir, '.vite/manifest.json');
	if (!fs.existsSync(manifestPath)) return [];
	const manifest: Record<string, { file: string; css?: string[]; assets?: string[] }> = JSON.parse(
		fs.readFileSync(manifestPath, 'utf-8')
	);
	const stylesheets = new Set(
		Object.values(manifest)
			.flatMap((chunk) => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])])
			.filter((file) => file.endsWith('.css'))
	);
	return (
		[...stylesheets]
			// SvelteKit compares the string length, not the byte size.
			.map((file) => ({
				file,
				length: fs.readFileSync(path.join(clientDir, file), 'utf-8').length
			}))
			.filter(({ length }) => length >= threshold)
	);
}

if (import.meta.main) {
	const negotiatedPrerenderFiles = findPrerenderedNegotiatedMarketingPages(
		path.resolve('.svelte-kit/output/prerendered/pages')
	);
	if (negotiatedPrerenderFiles.length > 0) {
		console.error(
			`[check-build-output] Negotiated marketing routes were prerendered and would bypass SvelteKit hooks on supported adapters:\n${negotiatedPrerenderFiles.join('\n')}`
		);
		process.exit(1);
	}
	const placeholderFiles = findPrerenderOriginPlaceholders(
		path.resolve('.svelte-kit/output/prerendered')
	);
	if (placeholderFiles.length > 0) {
		console.error(
			`[check-build-output] Prerendered output contains the SvelteKit placeholder origin:\n${placeholderFiles.join('\n')}`
		);
		process.exit(1);
	}
	for (const { file, length } of findLinkedStylesheets(
		path.resolve('.svelte-kit/output/client'),
		INLINE_STYLE_THRESHOLD
	)) {
		console.warn(
			`[check-build-output] ${file} has ${length} characters, at or above the inline threshold of ${INLINE_STYLE_THRESHOLD} in scripts/inline-styles.ts, so pages link it instead of inlining it. Shrink the stylesheet or raise the threshold.`
		);
	}
	console.log('[check-build-output] Prerendered output passed.');
}
