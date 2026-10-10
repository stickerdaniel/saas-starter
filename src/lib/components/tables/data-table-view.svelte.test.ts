import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

type Translate = (key: string) => string;

const translation = vi.hoisted(() => ({
	current: (() => '') as Translate,
	subscribe(run: (value: Translate) => void) {
		run(this.current);
		return () => {};
	}
}));
vi.mock('@tolgee/svelte', () => ({ getTranslate: () => ({ t: translation }) }));

import DataTableViewHarness from './test-fixtures/DataTableViewHarness.svelte';

translation.current = (key) => {
	const value = key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
	if (typeof value !== 'string') throw new Error(`Missing translation ${key}`);
	return value;
};

type Item = { id: string; name: string; role: string; note: string };

const items: Item[] = [
	{ id: 'a', name: 'Ada', role: 'admin', note: 'first' },
	{ id: 'b', name: 'Bo', role: 'user', note: 'second' }
];

let props = $state<{ loading: boolean; error: unknown; skeletonRows: number; data: Item[] }>({
	loading: false,
	error: undefined,
	skeletonRows: 0,
	data: []
});
let harness: ReturnType<typeof DataTableViewHarness> | undefined;

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
	if (harness) await unmount(harness);
	harness = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

function render(next: Partial<typeof props>) {
	props = { loading: false, error: undefined, skeletonRows: 0, data: [], ...next };
	harness = mount(DataTableViewHarness, { target: document.body, props });
	flushSync();
}

const bodyRows = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody > tr')];
const byTestId = (id: string) => document.querySelectorAll(`[data-testid="${id}"]`);

it('renders one hidden marker and aria-hidden skeleton rows with a cell per visible column', () => {
	render({ loading: true, skeletonRows: 3 });
	harness!.hide('role');
	flushSync();

	expect(byTestId('items-loading')).toHaveLength(1);
	const skeletonRows = bodyRows().filter((row) => row.getAttribute('aria-hidden') === 'true');
	expect(skeletonRows).toHaveLength(3);
	expect(bodyRows()).toHaveLength(4);
	for (const row of skeletonRows) expect(row.cells).toHaveLength(4);
	expect(byTestId('items-loading')[0]!.querySelector('td')!.colSpan).toBe(4);
	// The custom skeleton renders through its render configuration.
	expect(byTestId('skeleton-probe')).toHaveLength(3);
});

it('gives a column without metadata the text skeleton', () => {
	render({ loading: true, skeletonRows: 1 });

	const [, row] = bodyRows();
	const [, explicitText, defaultText, badge] = [...row!.cells];
	// Text bar widths vary by column, so compare the markup without them.
	const shape = (cell: HTMLTableCellElement) => cell.innerHTML.replace(/ style="[^"]*"/g, '');
	expect(shape(defaultText!)).toBe(shape(explicitText!));
	expect(defaultText!.querySelector('[data-slot="skeleton"]')).not.toBeNull();
	expect(shape(defaultText!)).not.toBe(shape(badge!));
});

it('drops the marker and skeletons once rows arrive', () => {
	render({ loading: true, skeletonRows: 2 });
	props.loading = false;
	props.data = items;
	flushSync();

	expect(byTestId('items-loading')).toHaveLength(0);
	expect(document.querySelector('tbody [aria-hidden="true"]')).toBeNull();
	expect(bodyRows().map((row) => row.dataset.testid)).toEqual(['item-a', 'item-b']);
	expect(byTestId('item-a')[0]!.textContent).toContain('Ada');
});

it('announces the wait in a status region that outlives it', () => {
	render({ loading: true, skeletonRows: 2 });
	const status = document.querySelector('[role="status"]');
	expect(status?.textContent).toBe('Loading rows');

	props.loading = false;
	props.data = items;
	flushSync();

	expect(document.querySelector('[role="status"]')).toBe(status);
	expect(status?.textContent).toBe('');
});

it('marks selected rows', () => {
	render({ data: items });
	harness!.select('b');
	flushSync();

	expect(bodyRows().map((row) => row.dataset.state ?? null)).toEqual([null, 'selected']);
});

it('renders the error row across the visible columns', () => {
	render({ error: new Error('boom'), data: items });
	harness!.hide('note');
	flushSync();

	expect(bodyRows()).toHaveLength(1);
	const cell = byTestId('items-error')[0] as HTMLTableCellElement;
	expect(cell.colSpan).toBe(4);
	expect(cell.textContent?.trim()).toBe(en.common.load_error);
	expect(byTestId('items-loading')).toHaveLength(0);
});

it.each([
	{ state: 'without rows', next: { data: [] } },
	{ state: 'while loading without predicted rows', next: { loading: true, skeletonRows: 0 } }
])('renders the empty row across the visible columns $state', ({ next }) => {
	render(next);
	harness!.hide('probe');
	flushSync();

	expect(bodyRows()).toHaveLength(1);
	const cell = byTestId('items-empty')[0] as HTMLTableCellElement;
	expect(cell.colSpan).toBe(4);
	expect(cell.textContent?.trim()).toBe('Nothing here');
	expect(byTestId('items-loading')).toHaveLength(0);
});
