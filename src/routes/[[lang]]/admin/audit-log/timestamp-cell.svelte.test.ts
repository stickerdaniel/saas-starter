import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import TimestampCell from './timestamp-cell.svelte';

let component: ReturnType<typeof mount> | undefined;

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

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

it('shows the time it gets', () => {
	component = mount(TimestampCell, {
		target: document.body,
		props: { text: '10/30/2044, 10:44:44 AM' }
	});
	flushSync();

	expect(document.body.textContent?.trim()).toBe('10/30/2044, 10:44:44 AM');
});
