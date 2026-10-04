import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import type * as Svelte from 'svelte';
import BotIcon from '@lucide/svelte/icons/bot';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import AvatarHeading from './avatar-heading.svelte';

let component: ReturnType<typeof mount> | undefined;

function render(props: ComponentProps<typeof AvatarHeading>) {
	component = mount(AvatarHeading, { target: document.body, props });
	flushSync();
}

const fallback = () => document.querySelector('[data-slot="avatar-fallback"]')!;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

it('takes the initials from the identity, not from a message title', () => {
	render({ title: 'Help with my invoice', subtitle: 'Ada · now', fallbackText: 'Ada Lovelace' });

	expect(fallback().textContent?.trim()).toBe('AL');
});

it('shows a neutral mark when a message row has no identity', () => {
	render({ title: 'Help with my invoice', subtitle: 'Anonymous · now' });

	expect(fallback().textContent?.trim()).toBe('?');
});

it('prefers the icon over any text', () => {
	render({ icon: BotIcon, title: 'Kai', subtitle: 'now', fallbackText: 'Kai' });

	expect(fallback().querySelector('svg')).not.toBeNull();
	expect(fallback().textContent?.trim()).toBe('');
});
