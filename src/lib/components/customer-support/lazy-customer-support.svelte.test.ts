import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('./support-unread-state.svelte.ts', () => ({
	useSupportUnreadState: () => ({ count: 0, hasUnread: false })
}));
vi.mock('./customer-support.svelte', () => import('./test-fixtures/LoadedSupport.svelte'));

import { goto } from '$app/navigation';
import LazySupportHost from './test-fixtures/LazySupportHost.svelte';

let component: ReturnType<typeof mount> | undefined;
let idleCallback: IdleRequestCallback | undefined;
const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
	idleCallback = callback;
	return 7;
});
const cancelIdleCallback = vi.fn();

function renderLauncher() {
	component = mount(LazySupportHost, { target: document.body });
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('SSR', false);
	vi.stubGlobal('requestIdleCallback', requestIdleCallback);
	vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
	vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
	window.history.replaceState({}, '', '/en');
	idleCallback = undefined;
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('lazy support loading', () => {
	it('waits for page assets before using an idle callback to load support', async () => {
		renderLauncher();
		expect(document.querySelector('button')).not.toBeNull();
		expect(requestIdleCallback).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain('Support ready');

		window.dispatchEvent(new Event('load'));
		expect(requestIdleCallback).toHaveBeenCalledOnce();
		idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });
		await vi.waitFor(() => expect(document.body.textContent).toContain('Support ready'));
	});

	it('opens immediately when the visitor clicks before the page finishes loading', async () => {
		renderLauncher();
		document.querySelector('button')?.click();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Support ready'));
		expect(goto).toHaveBeenCalledWith('/en?support=open', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('loads a direct support link without waiting for page assets or idle time', async () => {
		window.history.replaceState({}, '', '/en?support=open');
		renderLauncher();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Support ready'));
		expect(requestIdleCallback).not.toHaveBeenCalled();
	});

	it('cancels the scheduled preload when the visitor leaves', async () => {
		renderLauncher();
		window.dispatchEvent(new Event('load'));
		await unmount(component!);
		component = undefined;
		expect(cancelIdleCallback).toHaveBeenCalledWith(7);
	});
});
