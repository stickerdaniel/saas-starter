import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { Catalogue } from '$lib/licenses/catalogue';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import Harness from './test-fixtures/ThirdPartyLicensesHarness.svelte';

const entry = (name: string, license: string, text = `${name} license text`) => ({
	id: `npm:${name}@1.0.0`,
	kind: 'package' as const,
	name,
	version: '1.0.0',
	license,
	components: ['client'],
	sourceUrl: `https://github.com/example/${name}`,
	notices: [{ label: 'LICENSE', text }]
});

const catalogue: Catalogue = {
	schemaVersion: 1,
	entries: [
		entry('alpha', 'MIT'),
		entry('beta', 'Apache-2.0', '<img src=x onerror="window.__pwned = true">'),
		entry('gamma', 'MIT')
	]
};

let component: ReturnType<typeof mount> | undefined;

function respond(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

async function render(props: { available?: boolean } = {}) {
	component = mount(Harness, { target: document.body, props });
	await tick();
}

function status() {
	return document.querySelector('[role="status"]')?.textContent?.trim();
}

function rows() {
	return Array.from(document.querySelectorAll('li button'), (button) =>
		button.querySelector('span span')?.textContent?.trim()
	);
}

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('third-party licenses list', () => {
	it('searches entries and announces the result count', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(catalogue));
		await render();
		await vi.waitFor(() => expect(rows()).toEqual(['alpha', 'beta', 'gamma']));
		expect(fetch).toHaveBeenCalledWith(
			'/third-party-licenses.json',
			expect.objectContaining({ cache: 'no-cache' })
		);
		expect(status()).toBe('3 entries');

		const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
		expect(document.querySelector(`label[for="${search.id}"]`)?.textContent).toBe(
			'Search licenses'
		);
		search.value = 'apache';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(rows()).toEqual(['beta']);
		expect(status()).toBe('1 entry');

		search.value = 'no such package';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(rows()).toEqual([]);
		expect(status()).toBe('No matching entries');
	});

	it('opens a notice by keyboard and renders hostile text as text', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(catalogue));
		await render();
		await vi.waitFor(() => expect(rows()).toHaveLength(3));

		const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('li button')).find(
			(button) => button.textContent?.includes('beta')
		)!;
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.querySelector('pre')).toBeNull();
		trigger.focus();
		trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();
		expect(trigger.getAttribute('aria-expanded')).toBe('true');

		const notices = document.querySelectorAll('pre');
		expect(notices).toHaveLength(1);
		const notice = notices[0];
		expect(notice?.textContent).toBe('<img src=x onerror="window.__pwned = true">');
		expect(notice?.closest('[lang="en"]')).not.toBeNull();
		expect(document.querySelector('img')).toBeNull();
	});

	it('shows an error with a working retry', async () => {
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementationOnce(() => respond({}, 404))
			.mockImplementation(() => respond(catalogue));
		await render();
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain(
				'The license notices could not be loaded.'
			)
		);

		Array.from(document.querySelectorAll('button'))
			.find((button) => button.textContent?.includes('Try again'))!
			.click();
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('rejects a catalogue that does not match the schema', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			respond({ schemaVersion: 1, entries: [{ ...entry('alpha', 'MIT'), notices: [] }] })
		);
		await render();
		await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
		expect(rows()).toEqual([]);
	});

	it('explains that development builds have no catalogue without fetching', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		await render({ available: false });
		expect(document.body.textContent).toContain('not available in development');
		expect(fetch).not.toHaveBeenCalled();
	});
});
