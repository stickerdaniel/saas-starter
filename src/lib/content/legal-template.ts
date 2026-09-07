import { lex, type Extension } from 'svelte-streamdown';
import { renderAuthoredTemplate } from './authored-template';

const PLACEHOLDER_NAME = /^[A-Z][A-Z0-9_]*$/;
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
// Streamdown recurses through token.tokens only for branches that render children.
const CHILDREN_RENDERING_TOKEN_TYPES = new Set([
	'alert',
	'blockquote',
	'del',
	'description',
	'descriptionDetail',
	'descriptionList',
	'descriptionTerm',
	'em',
	'heading',
	'link',
	'list',
	'list_item',
	'mdx',
	'paragraph',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'text',
	'tfoot',
	'th',
	'thead',
	'tr'
]);

export interface LegalMarkdownContent {
	readonly markdown: string;
	readonly literals: Readonly<Record<string, string>>;
}

interface LegalLiteralToken {
	readonly type: 'legalLiteral';
	readonly raw: string;
	readonly name: string;
}

interface TokenRecord {
	readonly type: string;
	readonly raw: string;
	readonly tokens?: readonly unknown[];
}

const legalLiteralExtension: Extension = Object.freeze({
	name: 'legalLiteral',
	level: 'inline',
	start(source) {
		const index = source.indexOf('{{');
		return index === -1 ? undefined : index;
	},
	tokenizer(source) {
		const match = /^\{\{([A-Z][A-Z0-9_]*)\}\}/.exec(source);
		if (!match) return undefined;
		const token: LegalLiteralToken = {
			type: 'legalLiteral',
			raw: match[0]!,
			name: match[1]!
		};
		return token;
	}
});

export const legalLiteralExtensions: Extension[] = [legalLiteralExtension];
Object.freeze(legalLiteralExtensions);

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n?/g, '\n');
}

function tokenRecord(value: unknown, documentName: string): TokenRecord {
	if (!value || typeof value !== 'object') {
		throw new Error(`Invalid Markdown token in ${documentName}.`);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.type !== 'string' || typeof record.raw !== 'string') {
		throw new Error(`Invalid Markdown token in ${documentName}.`);
	}
	if (record.tokens !== undefined && !Array.isArray(record.tokens)) {
		throw new Error(`Invalid Markdown token in ${documentName}.`);
	}
	return {
		type: record.type,
		raw: record.raw,
		...(record.tokens === undefined ? {} : { tokens: record.tokens })
	};
}

function literalName(raw: string, documentName: string): string {
	const match = /^\{\{([A-Z][A-Z0-9_]*)\}\}$/.exec(raw);
	if (!match) {
		throw new Error(`Invalid legal literal token in ${documentName}.`);
	}
	return match[1]!;
}

function collectLegalLiterals(
	values: readonly unknown[],
	documentName: string,
	pathRendersChildren = true
): string[] {
	const names: string[] = [];
	for (const value of values) {
		const token = tokenRecord(value, documentName);
		if (token.type === 'legalLiteral') {
			if (!pathRendersChildren) {
				throw new Error(`Legal literal appears in a non-rendered position in ${documentName}.`);
			}
			names.push(literalName(token.raw, documentName));
		}
		if (token.tokens) {
			names.push(
				...collectLegalLiterals(
					token.tokens,
					documentName,
					pathRendersChildren && CHILDREN_RENDERING_TOKEN_TYPES.has(token.type)
				)
			);
		}
	}
	return names;
}

function placeholderNames(markdown: string): string[] {
	return [...markdown.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

function assertSameMultiset(expected: string[], actual: string[], documentName: string): void {
	const sortedExpected = expected.toSorted();
	const sortedActual = actual.toSorted();
	if (
		sortedExpected.length !== sortedActual.length ||
		sortedExpected.some((name, index) => name !== sortedActual[index])
	) {
		throw new Error(`Legal placeholders were not tokenized safely in ${documentName}.`);
	}
}

export function createLegalMarkdown(
	documentName: string,
	template: string,
	values: Readonly<Record<string, string>>
): LegalMarkdownContent {
	const literals: Record<string, string> = Object.create(null);
	const identityValues: Record<string, string> = Object.create(null);

	for (const name of Object.keys(values)) {
		const value = values[name];
		if (typeof value !== 'string') {
			throw new Error(`Invalid legal literal ${name} for ${documentName}.`);
		}
		if (value.includes('\0') || !value.isWellFormed()) {
			throw new Error(`Invalid legal literal ${name} for ${documentName}.`);
		}
		literals[name] = normalizeLineEndings(value);
		identityValues[name] = `{{${name}}}`;
	}

	const markdown = renderAuthoredTemplate(
		documentName,
		normalizeLineEndings(template),
		identityValues
	);
	const tokens: unknown = lex(markdown, legalLiteralExtensions);
	if (!Array.isArray(tokens)) {
		throw new Error(`Invalid Markdown tokens in ${documentName}.`);
	}
	assertSameMultiset(
		placeholderNames(markdown),
		collectLegalLiterals(tokens, documentName),
		documentName
	);

	Object.freeze(literals);
	return Object.freeze({ markdown, literals });
}

export function resolveLegalLiteral(
	token: unknown,
	literals: Readonly<Record<string, string>>
): string {
	if (!token || typeof token !== 'object') {
		throw new Error('Invalid legal literal token.');
	}
	const record = token as Record<string, unknown>;
	if (
		record.type !== 'legalLiteral' ||
		typeof record.raw !== 'string' ||
		typeof record.name !== 'string' ||
		!PLACEHOLDER_NAME.test(record.name) ||
		record.raw !== `{{${record.name}}}`
	) {
		throw new Error('Invalid legal literal token.');
	}
	if (!Object.prototype.hasOwnProperty.call(literals, record.name)) {
		throw new Error(`Missing legal literal ${record.name}.`);
	}
	const value = literals[record.name];
	if (typeof value !== 'string') {
		throw new Error(`Invalid legal literal ${record.name}.`);
	}
	return value;
}
