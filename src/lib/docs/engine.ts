import { parseBlocks } from 'svelte-streamdown';
import type { Tokens } from 'marked';
import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
import type { PageCode } from './code-lines';
import {
	HeadingIds,
	headingSlug,
	headingText,
	headingTree,
	plainText,
	type DocsHeading
} from './headings';
import { pageCode } from './highlight.server';
import {
	childTokens,
	hasInlineDestination,
	lexPage,
	resolveDocsHref,
	rewriteHrefs,
	type HrefContext,
	type LinkTargets,
	type ResolvedHref,
	type Token
} from './links';
import { isPublished } from './publication';
import type { DocsSearchPage, DocsSearchSection } from './search';
import { docsPath, type DocsFormat } from './urls';
import type { DocsCatalog, DocsPageEntry, DocsSource, RepositorySlug } from './types';

interface ParsedPage {
	entry: DocsPageEntry;
	title: string;
	description: string;
	markdown: string;
	body: string;
	headings: DocsHeading[];
}

export interface PublishedDocs {
	pages: ReadonlyMap<string, ParsedPage>;
	targets: LinkTargets;
	/** The repository paths outside the docs inventory that the pages link to as source files. */
	sourceFiles: readonly string[];
}

export interface DocsNavEntry {
	slug: string;
	section: string;
	title: string;
}

export interface DocsPageView {
	slug: string;
	section: string;
	title: string;
	description: string;
	/** The paragraph right below the H1, which the page header shows, or ''. */
	lead: string;
	/** The page's Markdown without its H1 and lead, with links resolved for this language. */
	body: string;
	headings: DocsHeading[];
	/** The highlighted lines of the page's fences. */
	code: PageCode;
	previous: DocsNavEntry | null;
	next: DocsNavEntry | null;
}

export interface DocsDiscoveryEntry {
	title: string;
	description: string;
	url: string;
	markdownUrl: string;
}

const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;
const VALIDATION_ORIGIN = 'https://docs.invalid';

function walk(tokens: readonly Token[]): Token[] {
	return tokens.flatMap((token) => [token, ...walk(childTokens(token))]);
}

function isHeading(token: Token): token is Token & Tokens.Heading {
	return token.type === 'heading';
}

type Destination = Token & { href: string };

function destinations(markdown: string): Destination[] {
	return walk(lexPage(markdown)).filter(
		(token): token is Destination =>
			['link', 'image', 'def'].includes(token.type) && typeof token.href === 'string'
	);
}

/**
 * The footnote of a page, which the renderer and GitHub show differently. `lexPage` drops a
 * footnote definition at the top level, and `parseBlocks` keeps it among the blocks it does not
 * render.
 */
function footnote(markdown: string, tokens: readonly Token[]): string | undefined {
	const blocks: NonNullable<Parameters<typeof parseBlocks>[2]> = {
		content: '',
		raws: [],
		keep: [],
		offsets: [0],
		keptBefore: [0],
		blocks: [],
		lastUpdate: 'first'
	};
	parseBlocks(markdown, [], blocks);
	return (
		blocks.raws.find((raw, index) => !blocks.keep[index] && raw.trim() !== '') ??
		walk(tokens).find((token) => token.type === 'footnote' || token.type === 'footnoteRef')?.raw
	);
}

function parsePage(entry: DocsPageEntry, source: DocsSource): ParsedPage {
	const fail = (problem: string): never => {
		throw new Error(`Docs page ${entry.source}: ${problem}`);
	};
	const markdown = (source.markdown[entry.source] ?? fail('the file does not exist')).replace(
		/\r\n|\r/g,
		'\n'
	);
	const tokens = lexPage(markdown);
	const note = footnote(markdown, tokens);
	if (note !== undefined) {
		fail(`docs pages have no footnotes, and it holds ${JSON.stringify(note.trim())}`);
	}
	const [first] = tokens;
	if (!first || !isHeading(first) || first.depth !== 1) fail('it must start with its H1');
	const h1 = first as Token & Tokens.Heading;
	if (walk(tokens).filter((token) => isHeading(token) && token.depth === 1).length !== 1) {
		fail('it must hold exactly one H1');
	}
	const unnamed = walk(tokens)
		.filter(isHeading)
		.find((heading) => headingSlug(headingText(heading.tokens)) === '');
	if (unnamed) {
		fail(
			`a heading needs a letter or a digit for its anchor, in its text or in the alt text of its image, and it holds ${JSON.stringify(unnamed.raw.trim())}`
		);
	}
	const start = markdown.indexOf(h1.raw);
	const body = markdown.slice(start + h1.raw.length).replace(/^(?:[ \t]*\n)+/, '');
	const bodyTokens = lexPage(body);
	const title = headingText(h1.tokens);
	const paragraph = bodyTokens.find((token) => token.type === 'paragraph') as
		Tokens.Paragraph | undefined;
	return {
		entry,
		title,
		description: plainText(paragraph?.tokens),
		markdown,
		body,
		headings: headingTree(title, walk(bodyTokens).filter(isHeading))
	};
}

type Resolved = Exclude<ResolvedHref, { kind: 'unresolved' }>;

function resolvedMarkdown(
	markdown: string,
	targets: LinkTargets,
	context: HrefContext,
	onResolved: (resolved: Resolved) => void = () => {}
): string {
	try {
		return rewriteHrefs(markdown, (href) => {
			const resolved = resolveDocsHref(href, targets, context);
			if (resolved.kind === 'unresolved') {
				throw new Error(`the link ${href} names no repository file`);
			}
			onResolved(resolved);
			return resolved.href;
		});
	} catch (error) {
		throw new Error(
			`Docs page ${context.page}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
}

/**
 * Fails unless the lexer finds, in order, the resolver's destination for each destination of
 * `markdown` in its rewritten text.
 */
function checkRewrite(
	markdown: string,
	rewritten: string,
	targets: LinkTargets,
	context: HrefContext
) {
	const before = destinations(markdown);
	const after = destinations(rewritten);
	for (let index = 0; index < Math.max(before.length, after.length); index++) {
		const token = before[index];
		const resolved = token && resolveDocsHref(token.href, targets, context);
		const expected = resolved && resolved.kind !== 'unresolved' ? resolved.href : undefined;
		const found = after[index]?.href;
		if (expected !== undefined && found === expected) continue;
		const definition =
			token &&
			token.type !== 'def' &&
			!hasInlineDestination(token) &&
			!before.some(({ type, href }) => type === 'def' && href === token.href);
		throw new Error(
			[
				`Docs page ${context.page}: the ${context.format} representation`,
				token
					? ` gives the destination ${token.href} as ${found ?? 'nothing'}`
					: ` gains the destination ${found}`,
				expected === undefined ? '' : `, not ${expected}`,
				definition
					? `, because the lexer reports no definition for ${token.raw}: move a reference definition inside a list item out of the list`
					: ''
			].join('')
		);
	}
}

/** The source files a page links to. Fails when a link names no file of the inventory. */
function validateLinks(page: ParsedPage, targets: LinkTargets): string[] {
	const sourceFiles: string[] = [];
	for (const [format, markdown] of [
		['html', page.body],
		['markdown', page.markdown]
	] satisfies Array<[DocsFormat, string]>) {
		const context = {
			page: page.entry.source,
			lang: DEFAULT_LANGUAGE,
			format,
			origin: VALIDATION_ORIGIN
		};
		const rewritten = resolvedMarkdown(markdown, targets, context, (link) => {
			if (link.kind === 'source') sourceFiles.push(link.path);
		});
		checkRewrite(markdown, rewritten, targets, context);
	}
	return sourceFiles;
}

/**
 * The catalog's pages when the catalog is published on `siteSlug`, or null. Every page is
 * parsed and its links resolved here, so a broken catalog fails the build that loads it.
 */
export function publishDocs(
	catalog: DocsCatalog,
	source: DocsSource,
	siteSlug: RepositorySlug
): PublishedDocs | null {
	if (!isPublished(catalog, siteSlug)) return null;
	const pages = new Map<string, ParsedPage>();
	catalog.pages.forEach((entry, index) => {
		const entrySlug = index === 0 ? entry.slug === '' : SLUG.test(entry.slug);
		if (!entrySlug) {
			throw new Error(
				`Docs page ${entry.source}: the first page has the slug '' and every other page a slug of lowercase path segments`
			);
		}
		if (pages.has(entry.slug)) throw new Error(`Docs slug '${entry.slug}' appears twice`);
		pages.set(entry.slug, parsePage(entry, source));
	});
	const targets: LinkTargets = {
		pages: new Map(catalog.pages.map((entry) => [entry.source, entry.slug])),
		source,
		sourceRepository: catalog.sourceRepository ?? catalog.site
	};
	if (targets.pages.size !== pages.size) throw new Error('A docs source file appears twice');
	const sourceFiles = [...pages.values()].flatMap((page) => validateLinks(page, targets));
	return { pages, targets, sourceFiles: [...new Set(sourceFiles)].toSorted() };
}

/** Every page in catalog order, for the sidebar, the mobile menu and previous and next. */
export function docsNavigation(docs: PublishedDocs): DocsNavEntry[] {
	return [...docs.pages.values()].map((page) => ({
		slug: page.entry.slug,
		section: page.entry.section,
		title: page.title
	}));
}

/**
 * The paragraph a body opens with, as written, when it renders the same on its own: a reference
 * link whose definition lies further down keeps the paragraph in the body.
 */
function leadParagraph(body: string): string {
	const [first] = lexPage(body);
	if (first?.type !== 'paragraph' || !first.raw) return '';
	const inPage = walk([first]).filter((token) => ['link', 'image'].includes(token.type));
	const alone = destinations(first.raw).filter((token) => token.type !== 'def');
	const same =
		inPage.length === alone.length &&
		inPage.every((token, index) => token.href === alone[index]?.href);
	return same ? first.raw : '';
}

export function docsPageView(docs: PublishedDocs, slug: string, lang: string): DocsPageView | null {
	const page = docs.pages.get(slug);
	if (!page) return null;
	const context = { page: page.entry.source, lang, format: 'html', origin: '' } as const;
	const navigation = docsNavigation(docs);
	const index = navigation.findIndex((entry) => entry.slug === slug);
	const lead = leadParagraph(page.body);
	const body = page.body.slice(lead.length);
	return {
		slug,
		section: page.entry.section,
		title: page.title,
		description: page.description,
		lead: resolvedMarkdown(lead, docs.targets, context),
		body: resolvedMarkdown(body, docs.targets, context),
		headings: page.headings,
		code: pageCode(body),
		previous: navigation[index - 1] ?? null,
		next: navigation[index + 1] ?? null
	};
}

/** The words a reader sees in a block, code fences left out. */
function blockText(token: Token): string {
	if (token.type === 'code') return '';
	if (['paragraph', 'heading', 'text'].includes(token.type)) {
		return token.tokens ? plainText(token.tokens as Token[]) : String(token.text ?? '');
	}
	if (token.type === 'codespan') return String(token.text ?? '');
	return childTokens(token).map(blockText).filter(Boolean).join(' ');
}

/**
 * Each page's title and its text split at its headings, with the heading ids the page and its
 * table of contents use.
 */
export function docsSearchIndex(docs: PublishedDocs): DocsSearchPage[] {
	return [...docs.pages.values()].map((page) => {
		const tokens = lexPage(page.body);
		const ids = new HeadingIds(page.title);
		for (const heading of walk(tokens).filter(isHeading)) ids.of(heading);
		const sections: DocsSearchSection[] = [{ id: null, heading: page.title, text: '' }];
		const visit = (token: Token): void => {
			if (isHeading(token)) {
				sections.push({ id: ids.of(token), heading: headingText(token.tokens), text: '' });
				return;
			}
			if (walk(childTokens(token)).some(isHeading)) {
				childTokens(token).forEach(visit);
				return;
			}
			const text = blockText(token).replace(/\s+/g, ' ').trim();
			const section = sections.at(-1)!;
			if (text) section.text = section.text ? `${section.text} ${text}` : text;
		};
		tokens.forEach(visit);
		return { slug: page.entry.slug, title: page.title, sections };
	});
}

/** The page's Markdown twin: the authored file with its H1 and every link resolved to an absolute URL. */
export function docsMarkdown(
	docs: PublishedDocs,
	slug: string,
	lang: string,
	origin: string
): string | null {
	const page = docs.pages.get(slug);
	if (!page) return null;
	const context = { page: page.entry.source, lang, format: 'markdown', origin } as const;
	return resolvedMarkdown(page.markdown, docs.targets, context);
}

export function docsDiscovery(docs: PublishedDocs | null, origin: string): DocsDiscoveryEntry[] {
	return [...(docs?.pages.values() ?? [])].map((page) => ({
		title: page.title,
		description: page.description,
		url: `${origin}${docsPath(DEFAULT_LANGUAGE, page.entry.slug)}`,
		markdownUrl: `${origin}${docsPath(DEFAULT_LANGUAGE, page.entry.slug, 'markdown')}`
	}));
}
