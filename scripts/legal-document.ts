import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Marked, type MarkedToken, type Token, type Tokens, type TokenizerExtension } from 'marked';
import type { Plugin } from 'vite';
import { renderAuthoredTemplate } from '../src/lib/content/authored-template';
import type { LegalNode, LegalTableCell, LegalTemplate } from '../src/lib/content/legal-template';

const QUERY = '?legal-document';
const PLACEHOLDER = /\{\{([^{}\r\n]*)\}\}/g;
const LITERAL = /^\{\{([A-Z][A-Z0-9_]*)\}\}/;
const DOCUMENT_ORIGIN = 'https://legal.invalid';
const EXTERNAL_LINK_PROTOCOLS = new Set(['https:', 'mailto:']);
const AMBIGUOUS_URL_CHARACTERS = /[\p{Cc}\\]/u;
const HEADING_DEPTHS = [1, 2, 3, 4, 5, 6] as const;

const legalLiteral: TokenizerExtension = {
	name: 'legalLiteral',
	level: 'inline',
	start(source) {
		const index = source.indexOf('{{');
		return index === -1 ? undefined : index;
	},
	tokenizer(source) {
		const match = LITERAL.exec(source);
		return match ? { type: 'legalLiteral', raw: match[0] } : undefined;
	}
};

const lexer = new Marked({ gfm: true, extensions: [legalLiteral] });

interface ParseState {
	readonly documentName: string;
	readonly base: URL;
	readonly literals: string[];
}

type LinkTarget =
	| { readonly type: 'link'; readonly href: string; readonly external: boolean }
	| { readonly type: 'localLink'; readonly path: string };

function linkTarget(href: string, base: URL): LinkTarget | null {
	if (!href || AMBIGUOUS_URL_CHARACTERS.test(href)) return null;
	if (href.startsWith('#')) return { type: 'link', href, external: false };
	const absolute = URL.parse(href);
	if (absolute) {
		return EXTERNAL_LINK_PROTOCOLS.has(absolute.protocol)
			? { type: 'link', href: absolute.href, external: true }
			: null;
	}
	const url = URL.parse(href, base);
	if (url?.origin !== base.origin) return null;
	const path = `${url.pathname}${url.search}${url.hash}`;
	if (path.startsWith('//')) return null;
	return href.startsWith('/')
		? { type: 'link', href: path, external: false }
		: { type: 'localLink', path };
}

function imageSource(href: string, base: URL): string | null {
	if (!href || AMBIGUOUS_URL_CHARACTERS.test(href)) return null;
	const absolute = URL.parse(href);
	if (absolute) return absolute.protocol === 'https:' ? absolute.href : null;
	const url = URL.parse(href, base);
	if (url?.origin !== base.origin) return null;
	const source = `${url.pathname}${url.search}${url.hash}`;
	return source.startsWith('//') ? null : source;
}

function parseLink(token: Tokens.Link, state: ParseState): LegalNode {
	const children = parseTokens(token.tokens, state);
	const target = linkTarget(token.href, state.base);
	if (!target) return { type: 'blocked', children };
	return { ...target, ...(token.title ? { title: token.title } : {}), children };
}

function parseImage(token: Tokens.Image, state: ParseState): LegalNode {
	const src = imageSource(token.href, state.base);
	return src === null
		? { type: 'text', value: token.text }
		: { type: 'image', src, alt: token.text };
}

function parseTable(token: Tokens.Table, state: ParseState): LegalNode {
	const cell = ({ align, tokens }: Tokens.TableCell): LegalTableCell => ({
		align,
		children: parseTokens(tokens, state)
	});
	return {
		type: 'table',
		head: token.header.map(cell),
		rows: token.rows.map((row) => row.map(cell))
	};
}

function parseLiteral(token: Token, state: ParseState): LegalNode {
	const name = LITERAL.exec(token.raw)?.[1];
	if (name === undefined) throw new Error(`Invalid legal literal in ${state.documentName}.`);
	state.literals.push(name);
	return { type: 'literal', name };
}

function parseToken(token: Token, state: ParseState): LegalNode[] {
	if (token.type === 'legalLiteral') return [parseLiteral(token, state)];
	const known = token as MarkedToken;
	switch (known.type) {
		case 'space':
		case 'def':
			return [];
		case 'heading': {
			const depth = HEADING_DEPTHS.find((value) => value === known.depth);
			if (depth === undefined) break;
			return [{ type: 'heading', depth, children: parseTokens(known.tokens, state) }];
		}
		case 'paragraph':
		case 'strong':
		case 'em':
			return [{ type: known.type, children: parseTokens(known.tokens, state) }];
		case 'hr':
			return [{ type: 'hr' }];
		case 'list':
			return [
				{
					type: 'list',
					ordered: known.ordered,
					start: typeof known.start === 'number' ? known.start : 1,
					items: known.items.map((item) => parseTokens(item.tokens, state))
				}
			];
		case 'table':
			return [parseTable(known, state)];
		case 'code':
			return [{ type: 'code', lang: known.lang ?? '', value: known.text }];
		case 'codespan':
			return [{ type: 'codespan', value: known.text }];
		case 'text':
			return known.tokens
				? parseTokens(known.tokens, state)
				: [{ type: 'text', value: known.text }];
		case 'link':
			return [parseLink(known, state)];
		case 'image':
			return [parseImage(known, state)];
		case 'html':
			throw new Error(`Raw HTML is not allowed in ${state.documentName}.`);
	}
	throw new Error(`Unsupported Markdown ${known.type} in ${state.documentName}.`);
}

function parseTokens(tokens: readonly Token[], state: ParseState): LegalNode[] {
	return tokens.flatMap((token) => parseToken(token, state));
}

/**
 * Parses authored legal Markdown into the element tree `legal-markdown.svelte` renders.
 * `{{NAME}}` placeholders become literal nodes and relative links become local links,
 * both resolved at render time.
 */
export function parseLegalMarkdown(documentName: string, source: string): LegalTemplate {
	const names = [...source.matchAll(PLACEHOLDER)].map((match) => match[1]!);
	const identity = Object.fromEntries(names.map((name) => [name, `{{${name}}}`]));
	const markdown = renderAuthoredTemplate(documentName, source, identity);
	const state: ParseState = {
		documentName,
		base: new URL(`/${encodeURIComponent(documentName)}`, DOCUMENT_ORIGIN),
		literals: []
	};
	const nodes = parseTokens(lexer.lexer(markdown), state);
	if (names.toSorted().join() !== state.literals.toSorted().join()) {
		throw new Error(`Legal placeholders were not tokenized safely in ${documentName}.`);
	}
	return { nodes };
}

/** Compiles `*.md?legal-document` imports into `LegalTemplate` modules, so no Markdown parser ships. */
export function legalDocument(): Plugin {
	return {
		name: 'legal-document',
		enforce: 'pre',
		async load(id) {
			if (!id.endsWith(QUERY)) return null;
			const file = id.slice(0, -QUERY.length);
			this.addWatchFile(file);
			const template = parseLegalMarkdown(path.basename(file, '.md'), await readFile(file, 'utf8'));
			return `export default ${JSON.stringify(template)};`;
		}
	};
}
