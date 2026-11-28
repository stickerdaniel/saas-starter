import { lex } from 'svelte-streamdown';
import { docsPath, type DocsFormat } from './urls';
import type { DocsSource, DocsSourcePath, RepositorySlug } from './types';

export interface LinkTargets {
	/** Slug of each published page by its source path. */
	pages: ReadonlyMap<string, string>;
	source: DocsSource;
	sourceRepository: RepositorySlug;
}

export interface HrefContext {
	page: DocsSourcePath;
	lang: string;
	format: DocsFormat;
	origin: string;
}

export type ResolvedHref =
	| { kind: 'unchanged' | 'page' | 'asset'; href: string }
	| { kind: 'source'; href: string; path: string }
	| { kind: 'unresolved' };

export interface Token {
	type: string;
	raw?: string;
	href?: string;
	[key: string]: unknown;
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** The tokens of a page as its renderer lexes it: static and without sources, so a bracket is no citation. */
export function lexPage(markdown: string): Token[] {
	return lex(markdown, [], undefined, false) as Token[];
}

export function childTokens(token: Token): Token[] {
	if (token.type === 'code' || token.type === 'codespan') return [];
	return Object.values(token).flatMap((value) =>
		Array.isArray(value)
			? value.filter(
					(item): item is Token => typeof item === 'object' && item !== null && 'type' in item
				)
			: []
	);
}

/** The repository path a link names, or null when it climbs above the repository root. */
function repositoryPath(page: DocsSourcePath, target: string): string | null {
	const base = target.startsWith('/') ? [] : page.split('/').slice(0, -1);
	const segments = [...base];
	for (const segment of target.split('/')) {
		if (segment === '..') {
			if (segments.pop() === undefined) return null;
		} else if (segment !== '.' && segment !== '') {
			segments.push(segment);
		}
	}
	const path = segments.join('/');
	return target.endsWith('/') && path ? `${path}/` : path;
}

function decoded(path: string): string | null {
	try {
		return decodeURIComponent(path);
	} catch {
		return null;
	}
}

/**
 * Whether the source inventory holds the file or directory a path under the docs root names.
 * Paths outside the root count as known here; `sourceFiles` of the published docs lists them
 * for a test that reads the file system.
 */
function isKnownPath(path: string, { root, markdown, assets }: DocsSource): boolean {
	if (!path.startsWith(root)) return true;
	if (path.endsWith('/')) {
		return [...Object.keys(markdown), ...Object.keys(assets)].some((file) => file.startsWith(path));
	}
	if (path.startsWith(`${root}assets/`)) return false;
	return !path.endsWith('.md') || Object.hasOwn(markdown, path);
}

/**
 * Where a link of an authored page points in a served representation: a published page to its
 * docs URL, an asset of the source to its built URL, any other repository path to GitHub. In
 * HTML a fragment of the page's own heading gets the page's path, so it stays a same-page link.
 */
export function resolveDocsHref(
	href: string,
	targets: LinkTargets,
	context: HrefContext
): ResolvedHref {
	const ownSlug = targets.pages.get(context.page);
	if (href.startsWith('#') && context.format === 'html' && ownSlug !== undefined) {
		return { kind: 'page', href: `${docsPath(context.lang, ownSlug)}${href}` };
	}
	if (href === '' || href.startsWith('#') || href.startsWith('//') || SCHEME.test(href)) {
		return { kind: 'unchanged', href };
	}
	const hashAt = href.indexOf('#');
	const hash = hashAt === -1 ? '' : href.slice(hashAt);
	const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
	const queryAt = beforeHash.indexOf('?');
	const query = queryAt === -1 ? '' : beforeHash.slice(queryAt);
	const target = decoded(queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt));
	const path = target === null ? null : repositoryPath(context.page, target);
	if (path === null) return { kind: 'unresolved' };

	const origin = context.format === 'markdown' ? context.origin : '';
	const slug = targets.pages.get(path);
	if (slug !== undefined) {
		if (query) return { kind: 'unresolved' };
		return {
			kind: 'page',
			href: `${origin}${docsPath(context.lang, slug, context.format)}${hash}`
		};
	}
	const asset = targets.source.assets[path];
	if (asset !== undefined) {
		if (query) return { kind: 'unresolved' };
		const url = context.format === 'markdown' ? new URL(asset, context.origin).href : asset;
		return { kind: 'asset', href: `${url}${hash}` };
	}
	if (!isKnownPath(path, targets.source)) return { kind: 'unresolved' };
	const view = path === '' || path.endsWith('/') ? 'tree' : 'blob';
	const encoded = path.split('/').map(encodeURIComponent).join('/');
	return {
		kind: 'source',
		path,
		href: `https://github.com/${targets.sourceRepository}/${view}/HEAD/${encoded}${query}${hash}`
	};
}

const DESTINATION_TOKENS = new Set(['link', 'image', 'def']);
const DEFINITION_START = /^ {0,3}\[(?:\\.|[^\\\]])*\]:[ \t]*(?:\n[ \t]*)?/;
const BACKSLASH_ESCAPE = /\\([\p{P}\p{S}])/gu;

/** The index of the `]` that closes a link label opened before `from`, or -1. */
function labelEnd(raw: string, from: number): number {
	let depth = 0;
	for (let index = from; index < raw.length; index++) {
		const char = raw[index];
		if (char === '\\') {
			index++;
		} else if (char === '`') {
			const ticks = /^`+/.exec(raw.slice(index))![0];
			const close = raw.indexOf(ticks, index + ticks.length);
			index = close === -1 ? index + ticks.length - 1 : close + ticks.length - 1;
		} else if (char === '[') {
			depth++;
		} else if (char === ']') {
			if (depth === 0) return index;
			depth--;
		}
	}
	return -1;
}

/** The end of a link destination that starts at `from`: angle brackets, or balanced parentheses. */
function destinationEnd(raw: string, from: number): number {
	if (raw[from] === '<') {
		for (let index = from + 1; index < raw.length && raw[index] !== '\n'; index++) {
			if (raw[index] === '\\') index++;
			else if (raw[index] === '>') return index + 1;
		}
		return from;
	}
	let depth = 0;
	let index = from;
	for (; index < raw.length; index++) {
		const char = raw[index]!;
		if (char === '\\') index++;
		else if (char <= ' ') break;
		else if (char === '(') depth++;
		else if (char === ')' && depth-- === 0) break;
	}
	return index;
}

/** Where the destination of an inline link, an image or a definition lies in its raw text. */
function destinationRange(token: Token & { raw: string }): [number, number] | null {
	let start: number;
	if (token.type === 'def') {
		const prefix = DEFINITION_START.exec(token.raw);
		if (!prefix) return null;
		start = prefix[0].length;
	} else {
		const open = token.type === 'image' ? '![' : '[';
		if (!token.raw.startsWith(open)) return null;
		const close = labelEnd(token.raw, open.length);
		if (close === -1 || token.raw[close + 1] !== '(') return null;
		start = close + 2 + /^\s*/.exec(token.raw.slice(close + 2))![0].length;
	}
	return [start, destinationEnd(token.raw, start)];
}

/**
 * A pattern for raw token text as it stands in the source: a container (a block quote, a list
 * item) strips its markers and indentation from the lines of its children's raw text.
 */
function sourcePattern(parts: readonly string[]): RegExp {
	const pattern = parts
		.map(
			(part) => `(${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\n', '\\n[ \\t>]*')})`
		)
		.join('');
	return new RegExp(pattern, 'dg');
}

function locate(
	markdown: string,
	parts: readonly string[],
	from: number,
	to: number
): RegExpIndicesArray | null {
	const pattern = sourcePattern(parts);
	pattern.lastIndex = from;
	const match = pattern.exec(markdown);
	return match?.indices && match.indices[0]![1] <= to ? match.indices : null;
}

function balanced(destination: string): boolean {
	let depth = 0;
	for (const char of destination) {
		if (char === '(') depth++;
		else if (char === ')' && --depth < 0) return false;
	}
	return depth === 0;
}

/**
 * Replaces the destination of every link, image and link reference definition that the page's
 * lexer finds with `rewrite(destination)`, and leaves every other byte of the source as written.
 */
export function rewriteHrefs(markdown: string, rewrite: (href: string) => string): string {
	const edits: Array<{ start: number; end: number; text: string }> = [];
	let cursor = 0;
	const visit = (tokens: readonly Token[], end: number): void => {
		for (const token of tokens) {
			const raw = token.raw;
			const href = token.href;
			const range =
				typeof raw === 'string' && typeof href === 'string' && DESTINATION_TOKENS.has(token.type)
					? destinationRange({ ...token, raw })
					: null;
			const parts =
				raw === undefined
					? null
					: range
						? [raw.slice(0, range[0]), raw.slice(...range), raw.slice(range[1])]
						: [raw];
			const found = parts && locate(markdown, parts, cursor, end);
			if (range && href !== undefined) {
				const [start, stop] = found?.[2] ?? [];
				const written = start === undefined ? undefined : markdown.slice(start, stop);
				const bracketed = written?.startsWith('<') ?? false;
				const unwrapped = bracketed ? written!.slice(1, -1) : written;
				if (unwrapped?.replace(BACKSLASH_ESCAPE, '$1').trim() !== href) {
					throw new Error(
						`the destination of ${JSON.stringify(raw)} cannot be placed in its source`
					);
				}
				const next = rewrite(href);
				if (next !== href) {
					const text = bracketed || /\s/.test(next) || !balanced(next) ? `<${next}>` : next;
					edits.push({ start: start!, end: stop!, text });
				}
			}
			if (found) {
				const [start, stop] = found[0]!;
				cursor = start;
				visit(childTokens(token), stop);
				cursor = stop;
			} else {
				visit(childTokens(token), end);
			}
		}
	};
	visit(lexPage(markdown), markdown.length);
	return edits
		.toSorted((a, b) => b.start - a.start)
		.reduce((text, { start, end, text: replacement }, index, sorted) => {
			if (end > (sorted[index - 1]?.start ?? markdown.length)) {
				throw new Error(`two link destinations overlap at offset ${start} of the source`);
			}
			return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
		}, markdown);
}

/** Whether a link or an image writes its destination in place, as opposed to a reference or an autolink. */
export function hasInlineDestination(token: Token): boolean {
	return typeof token.raw === 'string' && destinationRange({ ...token, raw: token.raw }) !== null;
}
