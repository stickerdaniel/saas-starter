import type { HighlighterCore } from 'shiki/core';

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getShikiHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			const { createHighlighterCore } = await import('shiki/core');
			const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
			return await createHighlighterCore({
				themes: [import('@shikijs/themes/github-dark'), import('@shikijs/themes/github-light')],
				langs: [
					import('@shikijs/langs/json'),
					import('@shikijs/langs/javascript'),
					import('@shikijs/langs/typescript'),
					import('@shikijs/langs/markdown')
				],
				engine: createJavaScriptRegexEngine()
			});
		})();
	}
	return highlighterPromise;
}
