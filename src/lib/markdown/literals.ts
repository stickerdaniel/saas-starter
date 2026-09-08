const MARKETING_MARKDOWN_TEXT: unique symbol = Symbol('MarketingMarkdownText');
const COMMONMARK_ESCAPABLE_PUNCTUATION = /[!-/:-@[-`{-~]/g;

export interface MarketingMarkdownText {
	readonly [MARKETING_MARKDOWN_TEXT]: true;
	readonly authoredSegments: readonly string[];
	readonly interpolations: readonly string[];
}

export type MarketingMarkdownContent = string | MarketingMarkdownText;

interface MarkdownTextParts {
	readonly authoredSegments: readonly string[];
	readonly interpolations: readonly string[];
}

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

function validateMarkdownTextParts(
	authoredSegments: unknown,
	interpolations: unknown
): MarkdownTextParts {
	if (
		!Array.isArray(authoredSegments) ||
		!authoredSegments.every((value) => typeof value === 'string')
	) {
		throw new Error('markdownText authoredSegments must be an array of strings.');
	}
	if (
		!Array.isArray(interpolations) ||
		!interpolations.every((value) => typeof value === 'string')
	) {
		throw new Error('markdownText interpolations must be an array of strings.');
	}
	if (authoredSegments.length !== interpolations.length + 1) {
		throw new Error(
			'markdownText authoredSegments must contain exactly one more item than interpolations.'
		);
	}

	for (const segment of authoredSegments) {
		assertValidText(segment);
	}
	for (const interpolation of interpolations) {
		assertValidText(interpolation);
	}

	return { authoredSegments, interpolations };
}

function getMarkdownTextParts(value: unknown): MarkdownTextParts {
	if (
		typeof value !== 'object' ||
		value === null ||
		!Object.prototype.hasOwnProperty.call(value, MARKETING_MARKDOWN_TEXT) ||
		(value as Record<PropertyKey, unknown>)[MARKETING_MARKDOWN_TEXT] !== true
	) {
		throw new Error('Markdown content objects must be created by markdownText.');
	}

	const branded = value as Record<PropertyKey, unknown>;
	return validateMarkdownTextParts(branded.authoredSegments, branded.interpolations);
}

export function markdownText(
	authoredSegments: TemplateStringsArray,
	...interpolations: string[]
): MarketingMarkdownText {
	const valid = validateMarkdownTextParts(authoredSegments, interpolations);

	return Object.freeze({
		[MARKETING_MARKDOWN_TEXT]: true as const,
		authoredSegments: Object.freeze([...valid.authoredSegments]),
		interpolations: Object.freeze([...valid.interpolations])
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
		.join('<br>');
}

export function renderMarkdownText(value: MarketingMarkdownContent): string {
	if (typeof value === 'string') {
		assertValidText(value);
		return value;
	}

	const { authoredSegments, interpolations } = getMarkdownTextParts(value);
	let markdown = authoredSegments[0]!;
	for (let index = 0; index < interpolations.length; index += 1) {
		markdown += encodeMarkdownLiteral(interpolations[index]!);
		markdown += authoredSegments[index + 1]!;
	}
	return markdown;
}

export function renderPlainText(value: MarketingMarkdownContent): string {
	if (typeof value === 'string') {
		return normalizePlainText(value);
	}

	const { authoredSegments, interpolations } = getMarkdownTextParts(value);
	let plainText = authoredSegments[0]!;
	for (let index = 0; index < interpolations.length; index += 1) {
		plainText += interpolations[index]!;
		plainText += authoredSegments[index + 1]!;
	}

	return normalizePlainText(plainText);
}
