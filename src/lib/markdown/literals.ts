const MARKETING_MARKDOWN_TEXT: unique symbol = Symbol('MarketingMarkdownText');
const COMMONMARK_ESCAPABLE_PUNCTUATION = /[!-/:-@[-`{-~]/g;

export interface MarketingMarkdownText {
	readonly [MARKETING_MARKDOWN_TEXT]: true;
	readonly authoredSegments: readonly string[];
	readonly interpolations: readonly string[];
}

export type MarketingMarkdownContent = string | MarketingMarkdownText;

function assertValidText(value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);

		if (codeUnit === 0) {
			throw new Error('Markdown text must not contain NUL characters.');
		}

		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const nextCodeUnit = value.charCodeAt(index + 1);
			if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
				throw new Error('Markdown text must not contain lone high UTF-16 surrogates.');
			}
			index += 1;
			continue;
		}

		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new Error('Markdown text must not contain lone low UTF-16 surrogates.');
		}
	}
}

function normalizePlainText(value: string): string {
	const normalized = value.replace(/\r\n?/g, '\n');
	assertValidText(normalized);
	return normalized;
}

export function markdownText(
	authoredSegments: TemplateStringsArray,
	...interpolations: string[]
): MarketingMarkdownText {
	return Object.freeze({
		[MARKETING_MARKDOWN_TEXT]: true as const,
		authoredSegments: Object.freeze([...authoredSegments]),
		interpolations: Object.freeze([...interpolations])
	});
}

export function encodeMarkdownLiteral(value: string): string {
	return normalizePlainText(value)
		.replace(COMMONMARK_ESCAPABLE_PUNCTUATION, '\\$&')
		.split('\n')
		.map((line) => {
			if (line.startsWith(' ')) {
				return `&#32;${line.slice(1)}`;
			}
			if (line.startsWith('\t')) {
				return `&#9;${line.slice(1)}`;
			}
			return line;
		})
		.join('\\\n');
}

export function renderMarkdownText(value: MarketingMarkdownContent): string {
	if (typeof value === 'string') {
		assertValidText(value);
		return value;
	}

	return value.authoredSegments
		.map((segment, index) => {
			assertValidText(segment);
			return index < value.interpolations.length
				? `${segment}${encodeMarkdownLiteral(value.interpolations[index]!)}`
				: segment;
		})
		.join('');
}

export function renderPlainText(value: MarketingMarkdownContent): string {
	if (typeof value === 'string') {
		return normalizePlainText(value);
	}

	let plainText = value.authoredSegments[0] ?? '';
	for (let index = 0; index < value.interpolations.length; index += 1) {
		plainText += value.interpolations[index] ?? '';
		plainText += value.authoredSegments[index + 1] ?? '';
	}

	return normalizePlainText(plainText);
}
