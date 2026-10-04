import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { CatalogueEntry } from '$lib/licenses/catalogue';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import Harness from './test-fixtures/ThirdPartyLicensesHarness.svelte';

const entry = (
	name: string,
	license: string,
	text = `${name} license text`,
	components = ['client']
): CatalogueEntry => ({
	id: `npm:${name}@1.0.0`,
	kind: 'package',
	name,
	version: '1.0.0',
	license,
	components,
	sourceUrl: `https://github.com/example/${name}`,
	notices: [{ label: 'LICENSE', text }]
});

const entries = [
	entry('alpha', 'MIT', 'Copyright (c) Alpha Holder'),
	entry('beta', 'Apache-2.0', '<img src=x onerror="window.__pwned = true">'),
	entry('gamma', 'MIT', 'gamma license text', ['client-worker'])
];

let component: ReturnType<typeof mount> | undefined;

async function render(props: { entries: CatalogueEntry[] | null }) {
	component = mount(Harness, { target: document.body, props });
	await tick();
}

function status() {
	return document.querySelector('[role="status"]')?.textContent?.trim();
}

function rows() {
	return Array.from(document.querySelectorAll('li details summary'), (summary) =>
		summary.querySelector('span span')?.textContent?.trim()
	);
}

function search(query: string) {
	const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
	input.value = query;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('third-party licenses list', () => {
	it('lists the entries at once and searches them', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		await render({ entries });
		expect(rows()).toEqual(['alpha', 'beta', 'gamma']);
		expect(status()).toBe('3 entries');
		expect(fetch).not.toHaveBeenCalled();

		const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
		expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Search licenses');
		search('apache');
		expect(rows()).toEqual(['beta']);
		expect(status()).toBe('1 entry');

		search('alpha holder');
		expect(rows()).toEqual(['alpha']);

		search('browser worker');
		expect(rows()).toEqual(['gamma']);

		search('no such package');
		expect(rows()).toEqual([]);
		expect(status()).toBe('No matching entries');
	});

	it('downloads the notices of the search results only', async () => {
		const files: Blob[] = [];
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			files.push(blob as Blob);
			return 'blob:licenses';
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
			this: HTMLAnchorElement
		) {
			this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		});
		await render({ entries });
		const download = document.querySelector<HTMLAnchorElement>('a[download]')!;
		expect(download.getAttribute('href')).toBe('/third-party-licenses.txt');
		expect(download.getAttribute('aria-label')).toBe('Download all notices as plain text');

		// Without a search, the link serves the published file.
		const unfiltered = new MouseEvent('click', { bubbles: true, cancelable: true });
		download.dispatchEvent(unfiltered);
		expect(unfiltered.defaultPrevented).toBe(false);
		expect(files).toHaveLength(0);

		search('apache');
		expect(download.getAttribute('aria-label')).toBe(
			'Download notices for 1 matching entry as plain text'
		);
		// The search results replace the published file, so the link must not download too.
		const filtered = new MouseEvent('click', { bubbles: true, cancelable: true });
		download.dispatchEvent(filtered);
		expect(filtered.defaultPrevented).toBe(true);
		expect(files).toHaveLength(1);
		const text = await files[0]!.text();
		expect(text).toContain('beta 1.0.0\nLicense: Apache-2.0');
		expect(text).toContain('Filtered by the search "apache".');
		expect(text).not.toContain('alpha');
		expect(text).not.toContain('gamma');

		search('no such package');
		const empty = new MouseEvent('click', { bubbles: true, cancelable: true });
		download.dispatchEvent(empty);
		expect(empty.defaultPrevented).toBe(true);
		expect(files).toHaveLength(1);
		expect(download.getAttribute('aria-disabled')).toBe('true');
	});

	it('renders closed notices as English text, including hostile markup', async () => {
		await render({ entries });

		const details = Array.from(document.querySelectorAll('li details'));
		expect(details.map((row) => row.hasAttribute('open'))).toEqual([false, false, false]);
		const notices = Array.from(document.querySelectorAll('details pre'), (pre) => pre.textContent);
		expect(notices).toEqual([
			'Copyright (c) Alpha Holder',
			'<img src=x onerror="window.__pwned = true">',
			'gamma license text'
		]);
		expect(document.querySelector('details pre')?.closest('[lang="en"]')).not.toBeNull();
		expect(document.querySelector('img')).toBeNull();
	});

	it('links each source from the closed row', async () => {
		await render({ entries });
		const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Source of alpha"]');
		expect(link?.href).toBe('https://github.com/example/alpha');
		// Reachable while the row is closed, and not nested in the toggle.
		expect(link?.closest('details')).toBeNull();
		expect(link?.closest('li')?.querySelector('details')?.hasAttribute('open')).toBe(false);
	});

	it('explains that development builds have no catalogue', async () => {
		await render({ entries: null });
		expect(document.body.textContent).toContain('not available in development');
		expect(document.querySelector('input[type="search"]')).toBeNull();
	});
});
