import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/theme.svelte.ts', () => ({ mode: { current: 'light' } }));

import { toast } from 'svelte-sonner';
import LazyToaster from './lazy-toaster.svelte';

let hidden = false;
let component: ReturnType<typeof mount> | undefined;
let idle: Map<number, () => void>;

beforeAll(() => import('./sonner.svelte'));

beforeEach(() => {
	vi.useFakeTimers();
	idle = new Map();
	vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
		const id = idle.size + 1;
		idle.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id));
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
	component = mount(LazyToaster, { target: document.body });
	flushSync();
});

afterEach(async () => {
	toast.dismiss();
	flushSync();
	vi.advanceTimersByTime(1000);
	if (component) await unmount(component);
	component = undefined;
	hidden = false;
	vi.doUnmock('./sonner.svelte');
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.replaceChildren();
});

function holdRenderer() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const chunk = { requests: 0, release };
	vi.doUnmock('./sonner.svelte');
	vi.doMock('./sonner.svelte', async (importOriginal) => {
		chunk.requests += 1;
		await gate;
		return importOriginal();
	});
	return chunk;
}

function toastsWith(message: string): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].filter((node) =>
		node.textContent?.includes(message)
	);
}

async function settle(): Promise<void> {
	await vi.dynamicImportSettled();
	await tick();
	flushSync();
}

function setHidden(value: boolean) {
	hidden = value;
	document.dispatchEvent(new Event('visibilitychange'));
	flushSync();
}

describe('LazyToaster', () => {
	it('shows a toast raised before the renderer loads exactly once', async () => {
		const chunk = holdRenderer();
		toast('Saved');
		flushSync();
		await vi.waitFor(() => expect(chunk.requests).toBe(1));
		expect(toastsWith('Saved')).toHaveLength(0);

		chunk.release();
		await vi.waitFor(() => expect(toastsWith('Saved')).toHaveLength(1));
		await settle();
		expect(toastsWith('Saved')).toHaveLength(1);
		expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
		expect(chunk.requests).toBe(1);
	});

	it('loads the renderer when the page is idle and mounts it on the first toast', async () => {
		const chunk = holdRenderer();
		expect(chunk.requests).toBe(0);

		for (const callback of idle.values()) callback();
		await vi.waitFor(() => expect(chunk.requests).toBe(1));
		chunk.release();
		await settle();
		expect(document.querySelector('section[aria-live]')).toBeNull();

		toast('Upload still in progress');
		flushSync();
		expect(toastsWith('Upload still in progress')).toHaveLength(1);
		expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
		expect(chunk.requests).toBe(1);
	});

	it('shows two toasts raised in a row', async () => {
		const chunk = holdRenderer();
		toast('First upload done');
		toast.error('Second upload failed');
		flushSync();
		chunk.release();

		await vi.waitFor(() => expect(toastsWith('Second upload failed')).toHaveLength(1));
		expect(toastsWith('First upload done')).toHaveLength(1);
	});

	it('keeps a toast while the tab is hidden', async () => {
		toast('Upload finished', { duration: 4000 });
		flushSync();
		await vi.waitFor(() => expect(toastsWith('Upload finished')).toHaveLength(1));

		setHidden(true);
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(toastsWith('Upload finished')).toHaveLength(1);

		setHidden(false);
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(toastsWith('Upload finished')).toHaveLength(0);
	});

	it('shows a later toast after the renderer failed to load', async () => {
		let failures = 0;
		vi.doMock('./sonner.svelte', () => {
			failures += 1;
			throw new Error('Failed to fetch dynamically imported module');
		});
		toast('Lost');
		flushSync();
		await vi.waitFor(() => expect(failures).toBe(1));
		await settle();
		expect(toastsWith('Lost')).toHaveLength(0);

		vi.doUnmock('./sonner.svelte');
		toast('Checkout failed');
		flushSync();
		await vi.waitFor(() => expect(toastsWith('Checkout failed')).toHaveLength(1));
	});
});
