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
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUPPORTED_LANGUAGE_CODES } from '../src/lib/i18n/language-codes.generated.js';
import { PUBLIC_MARKETING_ROUTES } from '../src/lib/marketing/public-routes';

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
	console.log('[check-build-output] Prerendered output passed.');
}
