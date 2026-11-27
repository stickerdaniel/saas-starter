import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as Publication from '#lib/docs/publication.js';

const docs = vi.hoisted(() => ({ published: true }));

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/env', () => ({ browser: true, dev: false }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/state', () => ({ page: { params: { lang: 'de' } } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('convex-svelte', () => ({ useQuery: vi.fn(() => ({ data: null })) }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('#lib/docs/publication.js', async (importOriginal) => ({
	...(await importOriginal<typeof Publication>()),
	get docsPublished() {
		return docs.published;
	}
}));

import { goto } from '$app/navigation';
import { SITE_CONFIG } from '#lib/config/site.js';
import { docsSearchIndex, publishDocs } from '#lib/docs/engine.js';
import { publishedCatalog } from '#lib/docs/__fixtures__/catalogs.js';
import { fixtureDocs } from '#lib/docs/__fixtures__/fixture-docs.js';
import SearchHost from './test-fixtures/SearchHost.svelte';
import './command-menu.svelte';

const index = docsSearchIndex(publishDocs(publishedCatalog, fixtureDocs, SITE_CONFIG.githubSlug)!);
let component: ReturnType<typeof mount> | undefined;
let fetch: ReturnType<typeof vi.fn>;

async function openMenu() {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
	flushSync();
	await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull(), {
		timeout: 10_000
	});
}

function type(text: string) {
	const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function docsGroup() {
	return [...document.querySelectorAll('[data-command-group]')].find((group) =>
		group.textContent?.startsWith('Documentation')
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	docs.published = true;
	fetch = vi.fn(async () => Response.json(index));
	vi.stubGlobal('fetch', fetch);
	Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
		configurable: true,
		value: vi.fn()
	});
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	component = mount(SearchHost, { target: document.body });
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe('the docs group of the command menu', () => {
	it('finds the second page by a word of its body and opens it in the reader language', async () => {
		await openMenu();
		await vi.waitFor(() => expect(docsGroup()).toBeDefined());
		expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/docs/search.json');
		type('back');
		await vi.waitFor(() => expect(docsGroup()?.textContent).toContain('Code page'));
		expect(docsGroup()!.textContent).not.toContain('Fixture guide');
		const item = [...docsGroup()!.querySelectorAll('[data-command-item]')].find((element) =>
			element.textContent?.includes('Code page')
		) as HTMLElement;
		item.click();
		expect(goto).toHaveBeenCalledWith('/de/docs/reference/code#plain-fence');
	}, 15_000);

	it('opens the fragment of a heading inside a blockquote', async () => {
		const nested =
			'# Nested\n\n> ## Deep heading\n>\n> Details about nested-search-needle.\n\n## Outside\n\nAn unrelated paragraph.\n';
		const source = {
			...fixtureDocs,
			markdown: { ...fixtureDocs.markdown, [publishedCatalog.pages[1]!.source]: nested }
		};
		const nestedIndex = docsSearchIndex(
			publishDocs(publishedCatalog, source, SITE_CONFIG.githubSlug)!
		);
		fetch.mockImplementation(async () => Response.json(nestedIndex));
		await openMenu();
		type('nested-search-needle');
		await vi.waitFor(() => expect(docsGroup()?.textContent).toContain('Deep heading'));
		(docsGroup()!.querySelector('[data-command-item]') as HTMLElement).click();
		expect(goto).toHaveBeenCalledWith('/de/docs/reference/code#deep-heading');
	}, 15_000);

	it('loads no index and shows no group while the catalog is unpublished', async () => {
		docs.published = false;
		await openMenu();
		type('back');
		await vi.dynamicImportSettled();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(docsGroup()).toBeUndefined();
	}, 15_000);
});
