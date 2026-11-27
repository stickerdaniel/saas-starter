/**
 * Builds the docs fixture app for adapter-node once per catalog variant and checks what its
 * Node server answers: every representation of the published fixture, and a 404 on every docs
 * URL of a catalog for another site or with no pages.
 *
 * Then it drives the published fixture in headless Chromium: axe, the table of contents, anchor
 * jumps with and without a top notice, search, Copy Page, the mobile menu, search by tap on a
 * phone and the phone menu without JavaScript.
 *
 * Usage: bun scripts/check-docs-fixture.ts
 */
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
	chromium,
	type Browser,
	type BrowserContextOptions,
	type Locator,
	type Page
} from '@playwright/test';
import {
	DOCS_FIXTURE_MARKER,
	findDocsFixtureMarker,
	findPrerenderedDocsFiles
} from './check-build-output';
import { buildFixture, fixtureKitOutput, serveFixture, type Variant } from './docs-fixture';

const ACCEPT = {
	html: 'text/html',
	markdown: 'text/markdown',
	none: undefined,
	'html over markdown': 'text/html;q=0.9, text/markdown;q=0.8',
	'markdown over html': 'text/html;q=0.8, text/markdown;q=0.9'
} as const;

interface Probe {
	path: string;
	method: 'GET' | 'HEAD';
	viewer: 'signed out' | 'signed in';
	accept: keyof typeof ACCEPT;
}

/** What the matrix asserts for each row; HEAD and GET of one request share every header. */
interface Asserted {
	status: number;
	type: string;
	vary: string;
	cache: string;
	location: string;
	canonical: string;
}

interface Row extends Probe, Asserted {
	link: string;
	bytes: number;
}

const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';
const MARKDOWN_CACHE = 'private, max-age=300, stale-while-revalidate=300';
const PAGE = '/en/docs/reference/code';
const PATHS = [
	PAGE,
	`${PAGE}.md`,
	'/en/docs',
	'/de/docs',
	'/docs',
	'/en/docs.md',
	'/de/docs.md',
	'/docs.md',
	'/en/docs/missing',
	'/en/docs/missing.md'
];
const SIGNED_IN_COOKIE = `better-auth.convex_jwt=${[
	{ alg: 'none' },
	{ sub: 'docs-fixture-viewer', exp: 4_102_444_800 }
]
	.map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
	.join('.')}.signature`;

const failures: string[] = [];
function check(condition: boolean, message: string): void {
	if (!condition) failures.push(message);
}

function canonicalOf(body: string, link: string | null): string {
	const tag = /<link rel="canonical" href="([^"]+)"/.exec(body)?.[1];
	return tag ?? /^<([^>]+)>; rel="canonical"$/.exec(link ?? '')?.[1] ?? '';
}

async function request(origin: string, row: Probe): Promise<{ row: Row; body: string }> {
	const accept = ACCEPT[row.accept];
	const response = await fetch(`${origin}${row.path}`, {
		method: row.method,
		redirect: 'manual',
		headers: {
			...(accept && { accept }),
			...(row.viewer === 'signed in' && { cookie: SIGNED_IN_COOKIE })
		}
	});
	const body = await response.text();
	return {
		row: {
			...row,
			status: response.status,
			type: response.headers.get('content-type') ?? '',
			vary: response.headers.get('vary') ?? '',
			cache: response.headers.get('cache-control') ?? '',
			location: response.headers.get('location') ?? '',
			link: response.headers.get('link') ?? '',
			canonical: canonicalOf(body, response.headers.get('link')),
			bytes: Buffer.byteLength(body)
		},
		body
	};
}

function expected(row: Probe, site: string, published: boolean): Asserted {
	const none = { vary: '', cache: '', location: '', canonical: '' };
	if (!/^\/[a-z]{2}\//.test(row.path)) {
		return { ...none, status: 307, type: '', location: `/en${row.path}` };
	}
	const markdown =
		row.path.endsWith('.md') || row.accept === 'markdown' || row.accept === 'markdown over html';
	const type = markdown ? MARKDOWN_TYPE : 'text/html';
	if (!published || row.path.includes('/missing')) {
		return { ...none, status: 404, type, vary: 'Accept', cache: 'no-store' };
	}
	const slug = row.path.replace(/^\/[a-z]{2}\/docs\/?/, '').replace(/\.md$/, '');
	const canonical = `${site}/en/docs${slug ? `/${slug}` : ''}`;
	return {
		...none,
		status: 200,
		type,
		vary: 'Accept',
		cache: markdown
			? MARKDOWN_CACHE
			: row.viewer === 'signed in'
				? 'private, no-cache'
				: 'public, no-cache',
		canonical: markdown || row.method === 'GET' ? canonical : ''
	};
}

const ASSERTED = ['status', 'type', 'vary', 'cache', 'location', 'canonical'] as const;
const SHARED_BY_HEAD = ['status', 'type', 'vary', 'cache', 'location', 'link'] as const;

function label(row: Probe): string {
	return `${row.method} ${row.path} ${row.viewer} Accept ${row.accept}`;
}

function expectRow(row: Row, site: string, variant: Variant = 'published'): void {
	const want = expected(row, site, variant === 'published');
	for (const field of ASSERTED) {
		check(
			row[field] === want[field],
			`${variant}: ${label(row)}: ${field} ${JSON.stringify(row[field])}, expected ${JSON.stringify(want[field])}`
		);
	}
	if (row.method === 'HEAD')
		check(row.bytes === 0, `${label(row)}: HEAD returned ${row.bytes} bytes`);
}

function expectHeadLikeGet(rows: readonly Row[]): void {
	for (const head of rows.filter((row) => row.method === 'HEAD')) {
		const get = rows.find(
			(row) =>
				row.method === 'GET' &&
				row.path === head.path &&
				row.viewer === head.viewer &&
				row.accept === head.accept
		);
		for (const field of SHARED_BY_HEAD) {
			check(
				get !== undefined && head[field] === get[field],
				`${label(head)}: ${field} ${JSON.stringify(head[field])}, GET has ${JSON.stringify(get?.[field])}`
			);
		}
	}
}

interface TreeHeading {
	id: string;
	children: TreeHeading[];
}

function headingIds(headings: readonly TreeHeading[]): string[] {
	return headings.flatMap((heading) => [heading.id, ...headingIds(heading.children)]);
}

/** Rebuilds plain values from SvelteKit's flattened `__data.json` node data. */
function unflatten(values: readonly unknown[], index: number): unknown {
	if (index < 0) return undefined;
	const value = values[index];
	if (Array.isArray(value)) return value.map((item: number) => unflatten(values, item));
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]: [string, number]) => [key, unflatten(values, item)])
		);
	}
	return value;
}

async function pageHeadings(origin: string, path: string): Promise<TreeHeading[]> {
	const payload: { nodes: Array<{ type: string; data?: unknown[] } | null> } = await (
		await fetch(`${origin}${path}/__data.json`)
	).json();
	const pageData = payload.nodes
		.map((node) => (node?.data ? unflatten(node.data, 0) : undefined))
		.findLast((data): data is { page: { headings: TreeHeading[] } } =>
			Boolean(data && typeof data === 'object' && 'page' in data)
		);
	return pageData?.page.headings ?? [];
}

async function checkPublished(origin: string, site: string): Promise<Row[]> {
	const requests: Probe[] = [
		...PATHS.flatMap((path) =>
			(['html', 'markdown', 'none'] as const).map((accept) => ({ path, accept }))
		),
		{ path: PAGE, accept: 'html over markdown' as const },
		{ path: PAGE, accept: 'markdown over html' as const }
	].flatMap(({ path, accept }) =>
		(['GET', 'HEAD'] as const).flatMap((method) =>
			(['signed out', 'signed in'] as const).map((viewer) => ({ path, method, viewer, accept }))
		)
	);
	const rows: Row[] = [];
	for (const entry of requests) {
		const { row } = await request(origin, entry);
		expectRow(row, site);
		rows.push(row);
	}
	expectHeadLikeGet(rows);

	const notFound = async (path: string, accept: Probe['accept']) =>
		(await request(origin, { path, method: 'GET', viewer: 'signed out', accept })).body;
	const twinNotFound = await notFound('/en/docs/missing.md', 'none');
	check(
		twinNotFound.startsWith('# 404 Not Found') &&
			twinNotFound === (await notFound('/en/docs/missing', 'markdown')),
		'/en/docs/missing.md must answer the Markdown not-found page of /en/docs/missing'
	);

	const { body: html } = await request(origin, {
		path: '/de/docs',
		method: 'GET',
		viewer: 'signed out',
		accept: 'html'
	});
	check(
		(html.match(/<h1[\s>]/g) ?? []).length === 1 && html.includes('<h1 id="fixture-guide"'),
		'/de/docs: expected exactly one h1, with the id of its title'
	);
	check(/<article lang="en"/.test(html), '/de/docs: the article must carry lang="en"');
	check(
		html.includes(DOCS_FIXTURE_MARKER),
		'/de/docs: the server response must hold the rendered body'
	);
	check(
		!/hreflang="de"/.test(html),
		'/de/docs: no hreflang alternate for an untranslated language'
	);
	check(!/og:locale:alternate/.test(html), '/de/docs: no alternate Open Graph locale');
	const htmlIds = [...html.matchAll(/<h[2-6][^>]* id="([^"]+)"/g)].map(([, id]) => id).join(' ');
	const treeIds = headingIds(await pageHeadings(origin, '/de/docs')).join(' ');
	check(
		htmlIds !== '' && htmlIds === treeIds,
		`heading ids in the HTML (${htmlIds}) must equal the page data's heading tree (${treeIds})`
	);

	const { body: codeHtml } = await request(origin, {
		path: '/en/docs/reference/code',
		method: 'GET',
		viewer: 'signed out',
		accept: 'html'
	});
	const fallback = [...codeHtml.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)]
		.map(([, content]) => content!)
		.find((content) => content.includes('<nav'));
	const fallbackPaths = [...(fallback ?? '').matchAll(/href="([^"]+)"/g)].map(
		([, href]) => new URL(href!, `${origin}/en/docs/reference/code`).pathname
	);
	for (const path of ['/en/', '/en/docs', '/en/pricing', '/en/docs/reference/code'])
		check(
			fallbackPaths.includes(path),
			`/en/docs/reference/code: the <noscript> navigation must link ${path}`
		);

	const image = /<img[^>]+src="([^"]+\.gif)#gh-light-mode-only"/.exec(html)?.[1];
	const asset = image ? await fetch(`${origin}${image}`) : undefined;
	check(
		asset?.status === 200 && asset.headers.get('content-type') === 'image/gif',
		`image ${image}: expected 200 image/gif`
	);

	const llms = await (await fetch(`${origin}/llms.txt`)).text();
	check(
		llms.includes('## Documentation') && llms.includes(`${site}/en/docs/reference/code.md`),
		'llms.txt must list the docs pages with their .md URLs'
	);
	const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
	check(
		sitemap.includes(`<loc>${site}/en/docs/reference/code</loc>`) &&
			!sitemap.includes(`${site}/de/docs`),
		'the sitemap must list the English URL of each page'
	);
	check(
		findDocsFixtureMarker(fixtureKitOutput).length > 0,
		'the fixture output must hold DOCS_FIXTURE_MARKER'
	);
	const index = await fetch(`${origin}/api/docs/search.json`);
	check(
		index.status === 200 && index.headers.get('content-type') === 'application/json',
		`the search index must answer 200 JSON, not ${index.status}`
	);
	for (const problem of await checkDocsBrowser(origin)) check(false, problem);
	return rows;
}

async function checkUnpublished(origin: string, site: string, variant: Variant): Promise<void> {
	for (const path of PATHS.filter((path) => /^\/[a-z]{2}\//.test(path)))
		for (const accept of ['html', 'markdown'] as const) {
			const { row } = await request(origin, { path, method: 'GET', viewer: 'signed out', accept });
			expectRow(row, site, variant);
		}
	const llms = await (await fetch(`${origin}/llms.txt`)).text();
	const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
	check(
		!llms.includes('## Documentation') && !sitemap.includes(`${site}/en/docs`),
		`${variant}: llms.txt and the sitemap must hold no docs line`
	);
	const index = await fetch(`${origin}/api/docs/search.json`);
	check(index.status === 404, `${variant}: the search index must answer 404, not ${index.status}`);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Whether `holds` turns true within five seconds. */
async function eventually(holds: () => Promise<boolean>): Promise<boolean> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (await holds()) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

const ACTION_TIMEOUT = 10_000;

async function newContext(browser: Browser, options: BrowserContextOptions) {
	const context = await browser.newContext(options);
	context.setDefaultTimeout(ACTION_TIMEOUT);
	return context;
}

async function axeViolations(page: Page, label: string): Promise<string[]> {
	const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
	return violations.map(
		(violation) =>
			`${label}: axe ${violation.id} on ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`
	);
}

async function openSearchAcrossReload(page: Page, open: () => Promise<void>): Promise<Locator> {
	const input = page.getByRole('dialog').getByRole('combobox');
	const reload = page.waitForEvent('load').then(
		() => 'reloaded' as const,
		() => 'none' as const
	);
	await open();
	if ((await Promise.race([input.waitFor().then(() => 'open' as const), reload])) === 'reloaded') {
		await page.waitForLoadState('networkidle');
		await open();
		await input.waitFor();
	}
	return input;
}

const TOC = 'nav[aria-labelledby="docs-toc-title"]';

function marked(page: Page): Promise<string | undefined> {
	return page
		.locator(`${TOC} a[aria-current="location"]`)
		.evaluateAll((links) => links[0]?.textContent?.trim());
}

function gapBelowHeader(page: Page, id: string): Promise<number> {
	return page.evaluate(
		(id) =>
			new Promise<number>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() =>
						resolve(
							document.getElementById(id)!.getBoundingClientRect().top -
								document.querySelector('header')!.getBoundingClientRect().bottom
						)
					)
				)
			),
		id
	);
}

async function headingTypeProblems(page: Page, label: string): Promise<string[]> {
	const type = await page.evaluate(() => {
		const read = (element: Element) => {
			const style = getComputedStyle(element);
			return {
				size: parseFloat(style.fontSize),
				lineHeight: parseFloat(style.lineHeight),
				weight: style.fontWeight,
				marginTop: style.marginTop,
				first: element.parentElement!.firstElementChild === element
			};
		};
		const of = (id: string) => read(document.getElementById(id)!);
		return {
			h3: of('requirements'),
			quote: of('a-heading-in-a-quote'),
			item: of('a-heading-in-a-list-item'),
			h5: of('a-fifth-level-heading'),
			body: read(document.querySelector('#a-fifth-level-heading + p')!)
		};
	});
	const problems: string[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
	const shown = ({ size, lineHeight, weight }: (typeof type)['h3']) =>
		`${size}px/${lineHeight}px at ${weight}`;
	for (const [name, nested] of [
		['a heading in a quote', type.quote],
		['a heading in a list item', type.item]
	] as const) {
		if (
			!near(nested.size, type.h3.size) ||
			!near(nested.lineHeight, type.h3.lineHeight) ||
			nested.weight !== type.h3.weight
		)
			problems.push(
				`${label}: ${name} must have the type of a top-level h3, ${shown(type.h3)}, not ${shown(nested)}`
			);
		if (!nested.first || nested.marginTop !== '0px')
			problems.push(
				`${label}: ${name} must open its container without a top margin, not ${nested.marginTop}`
			);
	}
	if (
		!near(type.h5.size, type.body.size * 0.875) ||
		!near(type.h5.lineHeight, type.h5.size * 1.5) ||
		type.h5.weight !== '500'
	)
		problems.push(
			`${label}: a fifth-level heading must have 0.875 of the body size at line height 1.5 and weight 500, not ${shown(type.h5)} beside a ${type.body.size}px body`
		);
	return problems;
}

async function separatorProblems(page: Page, label: string): Promise<string[]> {
	const copyPage = page
		.getByRole('button', { name: 'Copy Page', exact: true, includeHidden: true })
		.locator('xpath=..');
	if ((await copyPage.count()) !== 1) return [`${label}: the Copy Page control must render once`];
	const problems: string[] = [];
	for (const [name, control] of [
		['the docs header', page.locator('header')],
		['the Copy Page control', copyPage]
	] as const) {
		const count = await control.getByRole('separator', { includeHidden: true }).count();
		if (count) problems.push(`${label}: ${name} must expose no separator, not ${count}`);
	}
	return problems;
}

type Wanted =
	| string
	| { readonly em: number; readonly of?: 'parent' }
	| { readonly token: `--${string}` }
	| { readonly like: 'parent' };

type TypesetRow = readonly [what: string, selector: string, property: string, wanted: Wanted];

const QUOTE = '#blocks-in-blocks + blockquote';
const ITEM = (n: number) => `${QUOTE} + ul > li:nth-child(${n})`;
const BODY_LINK = 'article p a[href*="reference/code"]';
const SCREEN = { media: 'screen', forcedColors: 'none' } as const;

interface TypesetGroup {
	readonly media: Parameters<Page['emulateMedia']>[0];
	readonly route?: string;
	readonly focus?: string;
	readonly rows: readonly TypesetRow[];
}

const TYPESET: readonly TypesetGroup[] = [
	{
		media: SCREEN,
		rows: [
			['the body', 'article .typeset > div', 'margin-trim', 'block-start'],
			['a paragraph in a callout', 'article [data-slot="alert"] p', 'margin-top', '0px'],
			['a paragraph after a list in a quote', `${QUOTE} > ul + p`, 'margin-top', { em: 1.25 }],
			[
				'a heading after a paragraph in a quote',
				'#a-heading-after-a-paragraph',
				'margin-top',
				{ em: 1.25 }
			],
			[
				'a paragraph after a heading in a quote',
				'#a-heading-in-a-quote + p',
				'margin-top',
				{ em: 1 }
			],
			['a list in a quote', `${QUOTE} > ul`, 'margin-top', { em: 1.25 }],
			['a rule in a quote', `${QUOTE} > hr`, 'margin-top', { em: 3 }],
			['a heading after a rule in a quote', '#a-heading-after-a-rule', 'margin-top', { em: 1.25 }],
			['a second level in a quote', '#a-second-level-in-a-quote', 'margin-top', { em: 1.75 }],
			['a third level in a quote', '#a-third-level-in-a-quote', 'margin-top', { em: 1.25 }],
			['a fifth level in a quote', '#a-fifth-level-in-a-quote', 'margin-top', { em: 1.25 / 0.875 }],
			[
				'a sixth level in a quote',
				'#a-sixth-level-in-a-quote',
				'margin-top',
				{ em: 1.25 / 0.8125 }
			],
			['a paragraph after a heading', '#install-the-fixture + p', 'margin-top', { em: 1 }],
			['a table after a heading', '#requirements + div', 'margin-top', { em: 1.25 }],
			['a quote after a heading', '#headings-in-blocks + blockquote', 'margin-top', { em: 1.25 }],
			['a quote after a heading', '#blocks-in-blocks + blockquote', 'margin-top', { em: 1.25 }],
			['a callout after a heading', '#alerts + [data-slot="alert"]', 'margin-top', { em: 1.25 }],
			[
				'a paragraph after a heading in a list item',
				'#a-heading-in-a-list-item + p',
				'margin-top',
				{ em: 0.5 }
			],
			['the first block of a list item', `${ITEM(1)} > p`, 'margin-top', '0px'],
			['a list in a list item', `${ITEM(1)} > ul`, 'margin-top', { em: 0.5 }],
			['a second-level list', `${ITEM(1)} > ul`, 'list-style-type', 'circle'],
			['a third-level list', `${ITEM(1)} > ul > li > ul`, 'list-style-type', 'square'],
			['a quote in a list item', `${ITEM(2)} > blockquote`, 'margin-top', { em: 0.5 }],
			['a quote in a list item', `${ITEM(2)} > blockquote`, 'border-inline-start-width', '2px'],
			[
				'a table in a list item',
				`${ITEM(3)} > [data-streamdown-table]`,
				'margin-top',
				{ em: 1.25 }
			],
			['a subscript', 'article p > sub', 'font-size', { em: 0.75, of: 'parent' }],
			['a subscript', 'article p > sub', 'line-height', '0px'],
			['a subscript', 'article p > sub', 'bottom', { em: -0.25 }],
			['a superscript', 'article p > sup', 'font-size', { em: 0.75, of: 'parent' }],
			['a superscript', 'article p > sup', 'top', { em: -0.5 }],
			['a link in a superscript', 'article sup > a', 'text-decoration-line', 'none'],
			['a task list', 'article ul:has(> li > [data-slot="checkbox"])', 'list-style-type', 'none'],
			[
				'a task list',
				'article ul:has(> li > [data-slot="checkbox"])',
				'padding-inline-start',
				{ em: 0.25 }
			],
			['a task checkbox', 'article li > [data-slot="checkbox"]', 'margin-inline-end', { em: 0.5 }],
			['a task checkbox', 'article li > [data-slot="checkbox"]', 'vertical-align', { em: -0.1 }],
			[
				'a done task checkbox',
				'article li > [data-slot="checkbox"][data-state="checked"]',
				'background-color',
				{ token: '--primary' }
			],
			['a description list', 'article dl', 'margin-top', { em: 1.25 }],
			['a term', 'article dt', 'font-weight', '500'],
			['a term', 'article dt', 'margin-top', { em: 1 }],
			['a description', 'article dd', 'margin-top', { em: 0.25 }],
			['a description', 'article dd', 'margin-inline-start', '0px'],
			['a description', 'article dd', 'padding-inline-start', { em: 1 }],
			['a description', 'article dd', 'color', { token: '--muted-foreground' }],
			['a link in a description', 'article dd a', 'color', { like: 'parent' }],
			['a body link', BODY_LINK, 'color', { like: 'parent' }],
			['a body link', BODY_LINK, 'text-underline-offset', 'auto']
		]
	},
	{
		media: SCREEN,
		focus: BODY_LINK,
		rows: [
			['a focused link', BODY_LINK, 'outline-offset', '2px'],
			['a focused link', BODY_LINK, 'border-top-left-radius', { em: 0.125 }]
		]
	},
	{
		media: { media: 'print', forcedColors: 'none' },
		rows: [
			['printed body text', 'article .typeset', 'font-size', { em: 1, of: 'parent' }],
			['a printed quote', '#headings-in-blocks + blockquote', 'break-inside', 'avoid'],
			['a printed table', 'article table', 'break-inside', 'avoid'],
			['a printed heading', '#requirements', 'break-after', 'avoid']
		]
	},
	{
		media: { media: 'screen', forcedColors: 'active' },
		rows: [['inline code in forced colors', 'article p code', 'border-top-width', '1px']]
	},
	{
		media: SCREEN,
		route: '/en/docs/reference/code',
		rows: [
			[
				'a code block after a heading',
				'#highlighted-lines + [data-slot="docs-code"]',
				'margin-top',
				{ em: 1.25 }
			],
			[
				'a code block after a heading',
				'#plain-fence + [data-slot="docs-code"]',
				'margin-top',
				{ em: 1.25 }
			]
		]
	}
];

const LINKED_HEADING = 'a-heading-with-a-link';

async function headingLinkProblems(
	page: Page,
	label: string,
	warnings: readonly string[]
): Promise<string[]> {
	const problems: string[] = [];
	const served = await (await page.request.get(page.url())).text();
	const markup =
		new RegExp(`<h3[^>]*id="${LINKED_HEADING}"[^>]*>([\\s\\S]*?)</h3>`).exec(served)?.[1] ?? '';
	const servedHrefs = [...markup.matchAll(/<a\b[^>]*?href="([^"]*)"/g)].map(([, href]) => href);
	const shown = await page.evaluate((id) => {
		const heading = document.getElementById(id)!;
		return {
			nested: document.querySelectorAll('article a a').length,
			hrefs: [...heading.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? ''),
			permalink: heading.querySelector(`a[href="#${id}"]`)?.textContent?.trim()
		};
	}, LINKED_HEADING);
	if (shown.nested)
		problems.push(`${label}: a link must sit outside every other link, not ${shown.nested} nested`);
	if (!shown.hrefs.includes('/en/docs#alerts'))
		problems.push(`${label}: the link in #${LINKED_HEADING} must keep its href /en/docs#alerts`);
	if (shown.permalink !== '#')
		problems.push(
			`${label}: the permalink of #${LINKED_HEADING} must be its #, not ${JSON.stringify(shown.permalink)}`
		);
	if (servedHrefs.join(' ') !== shown.hrefs.join(' '))
		problems.push(
			`${label}: #${LINKED_HEADING} must hydrate the links the server sent (${servedHrefs.join(' ')}), not ${shown.hrefs.join(' ')}`
		);
	const hydration = warnings.filter((warning) => /hydrat/i.test(warning));
	if (hydration.length)
		problems.push(`${label}: the page must hydrate without a warning, not ${hydration[0]}`);
	for (const [heading, name, href] of [
		[LINKED_HEADING, 'Link to section A heading with a link', `#${LINKED_HEADING}`],
		[LINKED_HEADING, 'a link', '/en/docs#alerts'],
		['install-the-fixture', 'Install the fixture', '#install-the-fixture']
	] as const) {
		const named = page.locator(`#${heading}`).getByRole('link', { name, exact: true });
		const hrefs = await named.evaluateAll((links) =>
			links.map((link) => link.getAttribute('href'))
		);
		if (hrefs.length !== 1 || hrefs[0] !== href)
			problems.push(
				`${label}: #${heading} must hold one link named "${name}" with href ${href}, not ${JSON.stringify(hrefs)}`
			);
	}
	return problems;
}

async function mixedListProblems(page: Page, label: string): Promise<string[]> {
	const misses = await page.evaluate((heading) => {
		const mixed = document.querySelector(`#${heading} + p + ul`)!;
		const [task, item] = [...mixed.children];
		const ordinary = document.querySelector('#blocks-in-blocks ~ ul > li')!;
		const textLeft = (of: Element) => {
			const walker = document.createTreeWalker(of, NodeFilter.SHOW_TEXT, {
				acceptNode: (node) =>
					node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
			});
			const range = document.createRange();
			range.selectNodeContents(walker.nextNode()!);
			return range.getBoundingClientRect().left;
		};
		const marker = (of: Element) => getComputedStyle(of).listStyleType;
		const misses: string[] = [];
		if (marker(item!) !== 'disc')
			misses.push(`an item beside a task must show the disc marker, not ${marker(item!)}`);
		if (Math.abs(textLeft(item!) - textLeft(ordinary)) > 0.5)
			misses.push(
				`an item beside a task must start its text at ${textLeft(ordinary)}px like an ordinary item, not ${textLeft(item!)}px`
			);
		if (marker(task!) !== 'none')
			misses.push(`a task beside an item must show no marker, not ${marker(task!)}`);
		return misses;
	}, LINKED_HEADING);
	return misses.map((miss) => `${label}: ${miss}`);
}

async function typesetProblems(page: Page, label: string): Promise<string[]> {
	const problems: string[] = [];
	for (const { media, route, focus, rows } of TYPESET) {
		await page.emulateMedia(media);
		if (route) await page.goto(new URL(route, page.url()).href, { waitUntil: 'networkidle' });
		if (focus) {
			await page.keyboard.press('Shift');
			await page.locator(focus).first().focus();
		}
		const misses = await page.evaluate(
			(rows) =>
				rows.flatMap(([what, selector, property, wanted]) => {
					const element = document.querySelector(selector);
					if (!element) return [`${what} (${selector}) must exist`];
					const read = (of: Element) => getComputedStyle(of).getPropertyValue(property);
					const actual = read(element);
					if (typeof wanted === 'string')
						return actual === wanted
							? []
							: [`${what} must have ${property} ${wanted}, not ${actual}`];
					if ('em' in wanted) {
						const base = wanted.of === 'parent' ? element.parentElement! : element;
						const px = wanted.em * parseFloat(getComputedStyle(base).fontSize);
						return Math.abs(parseFloat(actual) - px) < 0.02
							? []
							: [
									`${what} must have ${property} ${wanted.em}em (${Math.round(px * 1000) / 1000}px), not ${actual}`
								];
					}
					let expected: string;
					if ('like' in wanted) expected = read(element.parentElement!);
					else {
						const probe = element.parentElement!.appendChild(document.createElement('span'));
						probe.style.color = `var(${wanted.token})`;
						expected = getComputedStyle(probe).color;
						probe.remove();
					}
					return actual === expected
						? []
						: [`${what} must have ${property} ${expected}, not ${actual}`];
				}),
			rows
		);
		problems.push(...misses.map((miss) => `${label}: ${miss}`));
	}
	await page.emulateMedia(SCREEN);
	return problems;
}

async function sidebarProblem(page: Page, label: string): Promise<string | undefined> {
	await page.evaluate(() => scrollTo(0, 600));
	const measure = () =>
		page.evaluate(() => {
			const header = document.querySelector('header')!.getBoundingClientRect().bottom;
			const rail = document
				.querySelector('nav[aria-label="Documentation"]')!
				.getBoundingClientRect();
			return {
				header,
				top: rail.top,
				bottom: rail.bottom,
				fits: rail.top >= header && rail.bottom <= innerHeight
			};
		});
	if (await eventually(async () => (await measure()).fits)) return undefined;
	const { header, top, bottom } = await measure();
	return `${label}: the sidebar must sit between the header and the viewport bottom, not from ${top} to ${bottom} with the header ending at ${header}`;
}

async function anchorProblems(page: Page, label: string): Promise<string[]> {
	const problems: string[] = [];
	const toc = page.locator(TOC);
	const shown = await toc.isVisible();
	const ids = await page.evaluate(() =>
		[...document.querySelectorAll('h1[id], article :is(h1, h2, h3, h4, h5, h6)[id]')].map(
			({ id }) => id
		)
	);
	for (const id of ids) {
		await page.evaluate((id) => {
			scrollTo(0, 0);
			location.hash = id;
		}, id);
		const gap = await gapBelowHeader(page, id);
		if (gap < 0)
			problems.push(`${label}: #${id} must start below the header, not ${-gap} px under it`);
	}
	if (!shown) return problems;
	for (const id of ids.slice(1)) {
		await page.evaluate(() => scrollTo(0, 0));
		const link = toc.locator(`a[href="#${id}"]`);
		await link.click();
		const gap = await gapBelowHeader(page, id);
		if (gap < 0)
			problems.push(
				`${label}: a click on ${id} must leave it below the header, not ${-gap} px under it`
			);
		const text = (await link.textContent())?.trim();
		const atEnd = await page.evaluate(
			() => scrollY + innerHeight >= document.documentElement.scrollHeight - 1
		);
		if (!atEnd && !(await eventually(async () => (await marked(page)) === text)))
			problems.push(`${label}: a click on ${id} must mark ${text}, not ${await marked(page)}`);
	}
	await page.evaluate(() => scrollTo(0, 600));
	const overlap = await page.evaluate(
		(toc) =>
			document.querySelector('header')!.getBoundingClientRect().bottom -
			document.querySelector(toc)!.closest('aside')!.getBoundingClientRect().top,
		TOC
	);
	if (overlap > 0)
		problems.push(`${label}: the table of contents starts ${overlap} px under the header`);
	await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
	const last = (await toc.locator('a').last().textContent())?.trim();
	if (!(await eventually(async () => (await marked(page)) === last)))
		problems.push(`${label}: the end of the page must mark ${last}, not ${await marked(page)}`);
	return problems;
}

/** Drives a served docs fixture in headless Chromium and returns every failed expectation. */
export async function checkDocsBrowser(origin: string): Promise<string[]> {
	const problems: string[] = [];
	const expect = (condition: boolean, message: string) => {
		if (!condition) problems.push(message);
	};
	const browser = await chromium.launch();
	try {
		for (const colorScheme of ['light', 'dark'] as const) {
			const context = await newContext(browser, {
				viewport: { width: 1440, height: 900 },
				colorScheme,
				permissions: ['clipboard-read', 'clipboard-write']
			});
			const page = await context.newPage();
			await page.goto(`${origin}/en/docs/reference/code`, { waitUntil: 'networkidle' });
			problems.push(...(await axeViolations(page, `/en/docs/reference/code ${colorScheme}`)));
			await page.goto(`${origin}/en/docs`, { waitUntil: 'networkidle' });
			problems.push(...(await axeViolations(page, `/en/docs ${colorScheme}`)));
			const diagrams = await page.evaluate(() =>
				[...document.querySelectorAll<HTMLImageElement>('article img[alt^="Diagram in"]')]
					.filter((image) => getComputedStyle(image).display !== 'none')
					.map((image) => image.alt)
			);
			expect(
				diagrams.join() === `Diagram in ${colorScheme} mode`,
				`/en/docs ${colorScheme} must show only the ${colorScheme} diagram, not ${diagrams.join(' and ')}`
			);
			if (colorScheme === 'dark') {
				await context.close();
				continue;
			}

			await page.evaluate(() => {
				const top = document.getElementById('alerts')!.getBoundingClientRect().top;
				scrollBy(0, top - 40);
			});
			const inBody = await eventually(async () => (await marked(page)) === 'Alerts');
			expect(
				inBody,
				`the table of contents must mark Alerts in the body of its section, not ${await marked(page)}`
			);
			await page
				.locator('nav[aria-labelledby="docs-toc-title"]')
				.getByRole('link', { name: 'Configure the fixture' })
				.click();
			const jumped = await eventually(async () => (await marked(page)) === 'Configure the fixture');
			expect(
				jumped,
				`the table of contents must mark the heading of a followed link, not ${await marked(page)}`
			);

			const twin = await (await fetch(`${origin}/en/docs.md`)).text();
			await page.getByRole('button', { name: 'Copy Page' }).click();
			const copied = await eventually(
				async () => (await page.evaluate(() => navigator.clipboard.readText())) === twin
			);
			expect(copied, "Copy Page must put the page's Markdown on the clipboard");

			const search = () => page.getByRole('button', { name: 'Search pages...' }).click();
			await (await openSearchAcrossReload(page, search)).fill('back');
			await page.getByRole('option', { name: /Code page/ }).click();
			const opened = await page
				.waitForURL(`${origin}/en/docs/reference/code#plain-fence`)
				.then(() => true)
				.catch(() => false);
			expect(
				opened,
				`search for a body word must open its section, /en/docs/reference/code#plain-fence, not ${page.url()}`
			);

			await (await openSearchAcrossReload(page, search)).fill('quoted');
			await page.getByRole('option', { name: /A heading in a quote/ }).click();
			const quoted = await page
				.waitForURL(`${origin}/en/docs#a-heading-in-a-quote`)
				.then(() => true)
				.catch(() => false);
			const quotedGap = quoted ? await gapBelowHeader(page, 'a-heading-in-a-quote') : NaN;
			expect(
				quotedGap >= 0,
				`search for a word under a heading in a quote must show that heading below the header, not ${page.url()} with ${quotedGap} px`
			);
			const quotedMarked = await eventually(
				async () => (await marked(page)) === 'A heading in a quote'
			);
			expect(
				quotedMarked,
				`search for a word under a heading in a quote must mark it, not ${await marked(page)}`
			);
			await context.close();
		}

		for (const width of [1440, 390])
			for (const notice of [false, true]) {
				const label = `/en/docs ${width}${notice ? ' with a top notice' : ''}`;
				const context = await newContext(browser, { viewport: { width, height: 900 } });
				const page = await context.newPage();
				const warnings: string[] = [];
				page.on('console', (message) => {
					if (message.type() === 'warning' || message.type() === 'error')
						warnings.push(message.text());
				});
				if (notice)
					await page.route('**/api/time', (route) =>
						route.fulfill({ json: { now: Date.now() - 6 * 3_600_000 } })
					);
				await page.goto(`${origin}/en/docs`, { waitUntil: 'networkidle' });
				const shown =
					!notice ||
					(await page
						.getByTestId('clock-skew-banner')
						.waitFor()
						.then(() => true)
						.catch(() => false));
				expect(shown, `${label}: the clock notice must show for a clock 6 h behind`);
				problems.push(...(await anchorProblems(page, label)));
				if (!notice)
					problems.push(
						...(await headingTypeProblems(page, label)),
						...(await separatorProblems(page, label)),
						...(await headingLinkProblems(page, label, warnings)),
						...(await mixedListProblems(page, label)),
						...(await typesetProblems(page, label))
					);
				await context.close();
			}

		const wide = await newContext(browser, { viewport: { width: 1440, height: 900 } });
		const desk = await wide.newPage();
		let showNotice = () => {};
		const noticeAsked = new Promise<void>((resolve) => (showNotice = resolve));
		await desk.route('**/api/time', async (route) => {
			await noticeAsked;
			await route.fulfill({ json: { now: Date.now() - 6 * 3_600_000 } });
		});
		await desk.goto(`${origin}/en/docs`);
		await desk.locator('nav[aria-label="Documentation"]').waitFor();
		const sidebarProblems = [await sidebarProblem(desk, '/en/docs 1440 without a notice')];
		showNotice();
		const banner = desk.getByTestId('clock-skew-banner');
		const noticed = await banner
			.waitFor()
			.then(() => true)
			.catch(() => false);
		expect(noticed, '/en/docs 1440: the clock notice must show after the page loaded');
		sidebarProblems.push(
			await sidebarProblem(desk, '/en/docs 1440 with a notice that appeared after load')
		);
		await desk.getByTestId('clock-skew-dismiss').click();
		await banner.waitFor({ state: 'detached' });
		sidebarProblems.push(await sidebarProblem(desk, '/en/docs 1440 after the notice left'));
		problems.push(...sidebarProblems.filter((problem) => problem !== undefined));
		await wide.close();

		const phone = await newContext(browser, { viewport: { width: 390, height: 844 } });
		const mobile = await phone.newPage();
		await mobile.goto(`${origin}/en/docs`, { waitUntil: 'networkidle' });
		const tableScroll = await mobile.evaluate(() =>
			[...document.querySelectorAll('article table')].map(
				(table) => getComputedStyle(table.parentElement!).overflowY
			)
		);
		expect(
			tableScroll.length > 0 && tableScroll.every((overflow) => overflow === 'hidden'),
			`/en/docs 390: a table must scroll only sideways, not with overflow-y ${tableScroll.join(', ')}`
		);
		await mobile.getByRole('button', { name: 'Menu' }).click();
		const menu = mobile.locator('[data-popover-content] nav');
		await menu.waitFor();
		const sheet = await mobile.evaluate(async () => {
			const content = document.querySelector('[data-popover-content]')!;
			await Promise.all(content.getAnimations().map((animation) => animation.finished));
			const box = content.getBoundingClientRect();
			const header = document.querySelector('header')!.getBoundingClientRect().bottom;
			const style = getComputedStyle(content);
			return {
				fits:
					box.left === 0 &&
					box.width === innerWidth &&
					box.top >= header &&
					box.bottom === innerHeight,
				box: `${box.left},${box.top} ${box.width}x${box.height} below ${header}`,
				flat:
					style.borderRadius === '0px' &&
					!/[1-9]/.test(style.boxShadow.replace(/[a-z]+\([^)]*\)/g, '')),
				shadow: style.boxShadow
			};
		});
		expect(
			sheet.fits && sheet.flat,
			`/en/docs 390: the open menu must fill the viewport below the header without ring, shadow or radius, not ${sheet.box} with ${sheet.shadow}`
		);
		problems.push(...(await axeViolations(mobile, '/en/docs 390 with the menu open')));
		await menu.getByRole('link', { name: 'Code page' }).click();
		const navigated = await mobile
			.waitForURL(`${origin}/en/docs/reference/code`)
			.then(() => true)
			.catch(() => false);
		expect(navigated, `the mobile menu must open the code page, not ${mobile.url()}`);
		expect((await menu.count()) === 0, 'the mobile menu must close after a choice');
		await phone.close();

		const touch = await newContext(browser, {
			viewport: { width: 390, height: 844 },
			hasTouch: true
		});
		const tapper = await touch.newPage();
		await tapper.goto(`${origin}/en/docs`, { waitUntil: 'networkidle' });
		const tap = () => tapper.getByRole('button', { name: 'Search pages' }).tap();
		await (await openSearchAcrossReload(tapper, tap)).fill('back');
		await tapper.getByRole('option', { name: /Code page/ }).tap();
		const searched = await tapper
			.waitForURL(`${origin}/en/docs/reference/code#plain-fence`)
			.then(() => true)
			.catch(() => false);
		expect(
			searched,
			`a tap on search at 390 px must find and open the code page, not ${tapper.url()}`
		);
		await touch.close();

		const scriptless = await newContext(browser, {
			viewport: { width: 390, height: 844 },
			javaScriptEnabled: false
		});
		const plain = await scriptless.newPage();
		await plain.goto(`${origin}/en/docs`);
		await plain.locator('details > summary').click();
		await plain.locator('details nav').getByRole('link', { name: 'Code page' }).click();
		const reached = await plain
			.waitForURL(`${origin}/en/docs/reference/code`)
			.then(() => true)
			.catch(() => false);
		expect(
			reached,
			`without JavaScript at 390 px the menu must open the code page, not ${plain.url()}`
		);
		await scriptless.close();
	} finally {
		await browser.close();
	}
	return problems;
}

function table(rows: Row[]): string {
	const columns = [
		'path',
		'method',
		'viewer',
		'accept',
		'status',
		'type',
		'vary',
		'cache',
		'location',
		'canonical',
		'bytes'
	] as const;
	return [
		`| ${columns.join(' | ')} |`,
		`| ${columns.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${columns.map((column) => String(row[column]) || '').join(' | ')} |`)
	].join('\n');
}

if (import.meta.main) {
	for (const variant of ['published', 'foreign-site', 'empty'] as const) {
		console.log(`\n== Docs fixture: ${variant}`);
		const site = await buildFixture(variant);
		const prerendered = findPrerenderedDocsFiles(path.join(fixtureKitOutput, 'prerendered'));
		check(prerendered.length === 0, `${variant}: prerendered docs files ${prerendered.join(', ')}`);
		const { server, origin } = await serveFixture();
		try {
			if (variant === 'published') console.log(table(await checkPublished(origin, site)));
			else await checkUnpublished(origin, site, variant);
		} finally {
			process.kill(server.pid!);
		}
	}

	if (failures.length > 0) {
		console.error(`\n[check-docs-fixture] ${failures.length} failure(s):\n${failures.join('\n')}`);
		process.exit(1);
	}
	console.log('\n[check-docs-fixture] Every docs fixture response matched.');
}
