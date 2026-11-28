import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/state', () => ({
	page: { params: { lang: 'en' }, url: new URL('https://example.com/en/docs') }
}));
vi.mock('#lib/components/LanguageSwitcher.svelte', () => ({ default: () => {} }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import { SITE_CONFIG } from '#lib/config/site.js';
import { docsNavigation, docsPageView, publishDocs } from '#lib/docs/engine.js';
import { publishedCatalog } from '#lib/docs/__fixtures__/catalogs.js';
import { fixtureDocs } from '#lib/docs/__fixtures__/fixture-docs.js';
import DocsHost from './test-fixtures/DocsHost.svelte';

const docs = publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!;
const navigation = docsNavigation(docs);
let component: ReturnType<typeof mount> | undefined;

function show(slug: string) {
	component = mount(DocsHost, {
		target: document.body,
		props: { page: docsPageView(docs, slug, 'en')!, navigation }
	});
	flushSync();
}

function button(name: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find(
		(element) => element.textContent?.trim() === name || element.getAttribute('aria-label') === name
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
}

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the docs layout', () => {
	it('renders a titled fence with its file name, numbered lines, the highlighted line and coloured code', async () => {
		show('reference/code');
		const fences = () => document.querySelectorAll('[data-slot="docs-code"]');
		await vi.waitFor(() => expect(fences()).toHaveLength(2));
		const figure = fences()[0]!;
		expect(figure.textContent).toContain('svelte.config.js');
		expect(figure.querySelector('pre')!.hasAttribute('data-line-numbers')).toBe(true);
		expect(
			[...figure.querySelectorAll('[data-highlighted-line]')].map((line) =>
				line.getAttribute('data-highlighted-line')
			)
		).toEqual(['2']);
		const tokens = [...figure.querySelectorAll<HTMLElement>('pre span span')];
		const colours = (theme: '--light' | '--dark') =>
			new Set(tokens.map((token) => token.style.getPropertyValue(theme)));
		expect(colours('--light').size).toBeGreaterThan(1);
		expect(colours('--dark').size).toBeGreaterThan(1);
		expect([...colours('--dark')].some((colour) => !colours('--light').has(colour))).toBe(true);
		const plain = fences()[1]!;
		expect(plain.querySelector('pre')!.hasAttribute('data-line-numbers')).toBe(false);
		expect(plain.querySelectorAll('[data-highlighted-line]')).toHaveLength(0);
	});

	it('renders each GitHub alert as the callout of its kind', () => {
		show('');
		const callouts = [...document.querySelectorAll('[role="note"]')].map((note) =>
			note.textContent?.replace(/\s+/g, ' ').trim()
		);
		expect(callouts).toEqual([
			'Note A note.',
			'Tip A tip.',
			'Important Something important.',
			'Warning A warning.',
			'Caution A caution.'
		]);
	});

	const order = ['install-the-fixture', 'requirements', 'example', 'configure-the-fixture'];
	const offset = (id: string) => 400 + 1000 * order.indexOf(id);
	const margin = 84;

	function scrollablePage(scrollHeight: number) {
		let scrolled = 0;
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
			this: Element
		) {
			const top = order.includes(this.id) ? offset(this.id) - scrolled : 5000;
			return { top, bottom: top + 30 } as DOMRect;
		});
		const computed = getComputedStyle;
		vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) =>
			/^H[2-6]$/.test(element.tagName)
				? ({ scrollMarginTop: `${margin}px` } as CSSStyleDeclaration)
				: computed(element, pseudo)
		);
		vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
		show('');
		const toc = document.querySelector('nav[aria-labelledby="docs-toc-title"]')!;
		const current = () => toc.querySelector('a[aria-current="location"]')?.textContent?.trim();
		const scrollTo = async (y: number) => {
			scrolled = y;
			vi.stubGlobal('scrollY', y);
			dispatchEvent(new Event('scroll'));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			flushSync();
			return current();
		};
		return { current, scrollTo };
	}

	it('marks the last heading that reached the line an anchor jump puts it on in the table of contents', async () => {
		const { current, scrollTo } = scrollablePage(0);
		expect(current()).toBe('Install the fixture');
		expect(await scrollTo(offset('requirements') - margin + 500)).toBe('Requirements');
		expect(await scrollTo(offset('requirements') - 900)).toBe('Install the fixture');
		expect(await scrollTo(offset('configure-the-fixture') - margin)).toBe('Configure the fixture');
	});

	it('marks the last heading of the page at the end of its scroll range', async () => {
		const end = 4000;
		const { scrollTo } = scrollablePage(end + innerHeight);
		expect(await scrollTo(end - 2)).toBe('Configure the fixture');
		expect(await scrollTo(end)).toBe('Links outside the docs');
	});

	it('gives the headings of the next page with the same title the ids its table of contents links', () => {
		const [first] = publishedCatalog.pages;
		const edited = publishDocs(
			publishedCatalog,
			{
				...fixtureDocs,
				markdown: {
					...fixtureDocs.markdown,
					[first!.source]:
						'# Fixture guide\n\nThe lead.\n\n## Example\n\nText.\n\n### Example\n\n## Alerts\n\n## Fixture guide\n'
				}
			},
			SITE_CONFIG.githubSlug
		)!;
		const props = $state({ page: docsPageView(docs, '', 'en')!, navigation });
		component = mount(DocsHost, { target: document.body, props });
		flushSync();
		props.page = docsPageView(edited, '', 'en')!;
		flushSync();
		const rendered = [...document.querySelectorAll('article :is(h2, h3, h4)')].map((h) => h.id);
		const linked = [...document.querySelectorAll('nav[aria-labelledby="docs-toc-title"] a')].map(
			(link) => link.getAttribute('href')
		);
		expect(rendered).toEqual(['example', 'example-1', 'alerts', 'fixture-guide-1']);
		expect(linked).toEqual(['#example', '#example-1', '#alerts', '#fixture-guide-1']);
	});

	it("puts the page's Markdown on the clipboard from Copy Page", async () => {
		const markdown = '# Fixture guide\n\nThe twin.\n';
		const fetch = vi.fn(async () => new Response(markdown));
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('fetch', fetch);
		vi.stubGlobal('isSecureContext', true);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
		show('');
		button('Copy Page').click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(markdown));
		expect(fetch).toHaveBeenCalledWith('/en/docs.md');
	});

	it('starts the clipboard write inside the Copy Page click, before the Markdown arrives', async () => {
		let answer!: (response: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
		);
		vi.stubGlobal('isSecureContext', true);
		class Item {
			parts: Record<string, Promise<Blob>>;
			constructor(parts: Record<string, Promise<Blob>>) {
				this.parts = parts;
			}
		}
		vi.stubGlobal('ClipboardItem', Item);
		const write = vi.fn(async ([item]: Item[]) => {
			await item!.parts['text/plain'];
		});
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
		show('');
		button('Copy Page').click();
		expect(write).toHaveBeenCalledTimes(1);
		answer(new Response('# Fixture guide\n'));
		const [item] = write.mock.calls[0]![0];
		await expect((await item!.parts['text/plain']!).text()).resolves.toBe('# Fixture guide\n');
	});

	it('opens the page actions menu from a press before the menu has loaded', async () => {
		show('');
		button('More page actions').click();
		await vi.waitFor(() =>
			expect(
				[...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
			).toEqual(['View as Markdown', 'Open in ChatGPT', 'Open in Claude'])
		);
		const markdown = document.querySelector<HTMLAnchorElement>('[role="menuitem"]')!;
		expect(markdown.getAttribute('href')).toBe('/en/docs.md');
	});

	it('opens the mobile menu, links each page and closes after a choice', async () => {
		show('');
		button('Menu').click();
		flushSync();
		const menu = () =>
			[...document.querySelectorAll('nav[aria-label="Documentation"]')].find((nav) =>
				nav.textContent?.includes('Menu')
			);
		await vi.waitFor(() => expect(menu()).toBeDefined());
		const link = [...menu()!.querySelectorAll('a')].find(
			(a) => a.textContent?.trim() === 'Code page'
		)!;
		expect(link.getAttribute('href')).toBe('/en/docs/reference/code');
		link.addEventListener('click', (event) => event.preventDefault());
		link.click();
		flushSync();
		await vi.waitFor(() => expect(menu()).toBeUndefined());
	});

	it.each([
		['', 'page'],
		['reference/code', null]
	])('on /en/docs/%s, marks the header docs link as the current page: %s', (slug, current) => {
		show(slug);
		const docsLink = document.querySelector('header a[href="/en/docs"]')!;
		expect(docsLink.getAttribute('aria-current')).toBe(current);
	});
});
