import { Lexer, type MarkedToken, type Tokens } from 'marked';

function newlinesBetween(text: string, start: number, end: number): number {
	let count = 0;
	for (let index = text.indexOf('\n', start); index >= 0 && index < end;) {
		count++;
		index = text.indexOf('\n', index + 1);
	}
	return count;
}

/**
 * Blanks every fenced and indented code block while keeping the line count, so prose keeps its
 * source line numbers. Indentation is relative to list and block-quote containers, so the
 * CommonMark lexer decides what is code rather than a column heuristic.
 */
export function withoutCodeBlocks(text: string): string {
	const source = text.replace(/\r\n?/g, '\n');
	const lines = source.split('\n');

	const blank = (code: Tokens.Code, firstLine: number): void => {
		const codeLines = code.raw.replace(/\n$/u, '').split('\n');
		// Container markers are stripped from the lexed text, so each code line must end its source line.
		const located = codeLines.every((codeLine, offset) => {
			const content = codeLine.trim();
			return content === '' || lines[firstLine + offset]?.trimEnd().endsWith(content) === true;
		});
		if (!located) return;
		for (let offset = 0; offset < codeLines.length; offset++) {
			if (firstLine + offset < lines.length) lines[firstLine + offset] = '';
		}
	};

	// Container text keeps one line per source line, so a child's offset in it is a line offset.
	const visit = (tokens: MarkedToken[], containerText: string, firstLine: number): void => {
		let cursor = 0;
		// Lines are counted from the previous child onward, so long containers stay linear.
		let line = firstLine;
		let counted = 0;
		for (const token of tokens) {
			const index = containerText.indexOf(token.raw, cursor);
			if (index < 0) continue;
			line += newlinesBetween(containerText, counted, index);
			counted = index;
			cursor = index + token.raw.length;
			if (token.type === 'code') blank(token, line);
			else if (token.type === 'list') visit(token.items, token.raw, line);
			else if (token.type === 'blockquote' || token.type === 'list_item') {
				visit(token.tokens as MarkedToken[], token.text, line);
			}
		}
	};

	visit(new Lexer().lex(source) as MarkedToken[], source, 0);
	return lines.join('\n');
}
