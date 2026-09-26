import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import SupportUnreadIndicator from './support-unread-indicator.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('SupportUnreadIndicator', () => {
	// The badge stays mounted at zero so its close can play; recomputing the label
	// on the way out painted a red "0" for the length of the collapse.
	it('caps the count and keeps the last label through the close', () => {
		const props = $state({ count: 3 });
		component = mount(SupportUnreadIndicator, { target: document.body, props });
		flushSync();
		const label = () =>
			document.querySelector('[data-testid="support-unread-indicator"]')?.textContent?.trim();
		expect(label()).toBe('3');

		props.count = 12;
		flushSync();
		expect(label()).toBe('9+');

		props.count = 0;
		flushSync();
		expect(label()).toBe('9+');
	});
});
