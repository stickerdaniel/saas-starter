import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true, dev: false }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/state', () => ({ page: { params: { lang: 'en' } } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('convex-svelte', () => ({ useQuery: vi.fn(() => ({ data: null })) }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import { useQuery } from 'convex-svelte';
import SearchHost from './test-fixtures/SearchHost.svelte';
// Compiling the menu's module graph takes seconds on a cold run. Loading it with the
// test file keeps that cost out of whichever test first asks the shell to load the menu;
// the shell still mounts the menu only on intent, which is what these tests observe.
import './command-menu.svelte';

let component: ReturnType<typeof mount> | undefined;

function trigger() {
	return document.querySelector<HTMLButtonElement>('button[aria-label="Open search"]')!;
}

function shortcut(key: string, modifiers: KeyboardEventInit = {}, target: EventTarget = document) {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...modifiers
	});
	target.dispatchEvent(event);
	flushSync();
	return event;
}

async function settleImports() {
	await vi.dynamicImportSettled();
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	// JSDOM has no layout scrolling; the real command menu scrolls its active item.
	Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
		configurable: true,
		value: vi.fn()
	});
	component = mount(SearchHost, { target: document.body });
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('search loading on intent', () => {
	it('leaves the menu unloaded while the visitor scrolls and uses unrelated controls', async () => {
		window.dispatchEvent(new Event('load'));
		window.dispatchEvent(new Event('scroll'));
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		shortcut('a');
		flushSync();
		await settleImports();
		expect(vi.mocked(useQuery).mock.calls.length).toBe(0);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it.each(['pointerenter', 'focus'])('preloads on %s without opening the menu', async (event) => {
		trigger().dispatchEvent(new Event(event));
		flushSync();
		await settleImports();
		expect(useQuery).toHaveBeenCalledOnce();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		trigger().click();
		await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
	});

	it.each([
		['k', { metaKey: true }],
		['k', { ctrlKey: true }],
		['/', {}]
	] as const)(
		'opens on the first %s shortcut and keeps one shortcut owner after loading',
		async (key, modifiers) => {
			expect(shortcut(key, modifiers).defaultPrevented).toBe(true);
			await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
			expect(document.body.textContent).toContain('Pricing');
			shortcut(key, modifiers);
			await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
			shortcut(key, modifiers);
			await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
		}
	);

	it('keeps shortcuts available for editing another input', async () => {
		const input = document.querySelector('input')!;
		expect(shortcut('/', {}, input).defaultPrevented).toBe(false);
		expect(shortcut('k', { ctrlKey: true }, input).defaultPrevented).toBe(false);
		await settleImports();
		expect(vi.mocked(useQuery).mock.calls.length).toBe(0);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});
});
