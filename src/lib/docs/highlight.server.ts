import { tokenize } from '@tanstack/highlight';
import type { Tokens } from 'marked';
import { codeKey, fenceCode, type CodeToken, type PageCode } from './code-lines';
import { childTokens, lexPage, type Token } from './links';

function highlightLines(code: string, lang: string | undefined): CodeToken[][] {
	const lines: CodeToken[][] = [[]];
	for (const { value, className } of tokenize(code, { lang }).tokens) {
		value.split('\n').forEach((part, index) => {
			if (index > 0) lines.push([]);
			if (part) lines.at(-1)!.push(className ? { value: part, className } : { value: part });
		});
	}
	return lines;
}

function fences(tokens: readonly Token[]): Array<Token & Tokens.Code> {
	return tokens.flatMap((token) =>
		token.type === 'code' ? [token as Token & Tokens.Code] : fences(childTokens(token))
	);
}

/**
 * Highlights each fence of a page on the server, so the browser renders the coloured lines
 * without loading the highlighter.
 */
export function pageCode(markdown: string): PageCode {
	return Object.fromEntries(
		fences(lexPage(markdown)).map(({ lang, text }) => {
			const code = fenceCode(text);
			return [codeKey(lang, code), highlightLines(code, lang)];
		})
	);
}
