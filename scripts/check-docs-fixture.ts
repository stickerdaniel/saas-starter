/**
 * Builds the docs fixture app for adapter-node once per catalog variant and checks what its
 * Node server answers: every representation of the published fixture, and a 404 on every docs
 * URL of a catalog for another site or with no pages.
 *
 * Usage: bun scripts/check-docs-fixture.ts
 */
import path from 'node:path';
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
