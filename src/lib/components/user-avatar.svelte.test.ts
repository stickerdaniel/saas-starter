import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import UserAvatar from './user-avatar.svelte';

/** Image loads that the test completes by hand. */
class ControlledImage {
	static requests: ControlledImage[] = [];
	src = '';
	crossOrigin: string | null = null;
	referrerPolicy = '';
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		ControlledImage.requests.push(this);
	}
}

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	ControlledImage.requests = [];
	vi.stubGlobal('Image', ControlledImage);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

const fallback = () => document.querySelector<HTMLElement>('[data-slot="avatar-fallback"]')!;

it('shows the initials again when a loaded photo is removed', async () => {
	const props = $state({
		name: 'John Smith',
		image: 'https://example.com/john.png' as string | null
	});
	component = mount(UserAvatar, { target: document.body, props });
	flushSync();

	ControlledImage.requests.at(-1)!.onload!();
	await vi.waitFor(() => expect(fallback().style.display).toBe('none'));

	props.image = null;
	flushSync();

	expect(fallback().style.display).not.toBe('none');
	expect(fallback().textContent?.trim()).toBe('JS');
});
