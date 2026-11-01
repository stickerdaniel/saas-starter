import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('mode-watcher', () => ({ mode: { current: 'light' } }));

import { toast } from 'svelte-sonner';
import Toaster from './sonner.svelte';

let hidden = false;
let component: ReturnType<typeof mount> | undefined;

function setHidden(value: boolean) {
	hidden = value;
	document.dispatchEvent(new Event('visibilitychange'));
	flushSync();
}

function shown(message: string): boolean {
	return document.body.textContent?.includes(message) ?? false;
}

beforeEach(() => {
	vi.useFakeTimers();
	// jsdom has no matchMedia; the toaster reads the color scheme.
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
	component = mount(Toaster, { target: document.body });
	flushSync();
});

afterEach(() => {
	toast.dismiss();
	if (component) unmount(component);
	component = undefined;
	hidden = false;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe('Toaster', () => {
	it('keeps a toast while the tab is hidden and spends the rest once it is back', () => {
		toast('Saved', { duration: 4000 });
		flushSync();
		vi.advanceTimersByTime(1000);
		expect(shown('Saved')).toBe(true);

		setHidden(true);
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(shown('Saved')).toBe(true);

		setHidden(false);
		vi.advanceTimersByTime(2500);
		flushSync();
		expect(shown('Saved')).toBe(true);

		vi.advanceTimersByTime(1500);
		// Sonner removes the toast after its exit animation.
		vi.advanceTimersByTime(1000);
		flushSync();
		expect(shown('Saved')).toBe(false);
	});

	it('does not start the timer for a toast created in a hidden tab', () => {
		setHidden(true);
		toast('Upload finished', { duration: 4000 });
		flushSync();
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(shown('Upload finished')).toBe(true);
	});
});
