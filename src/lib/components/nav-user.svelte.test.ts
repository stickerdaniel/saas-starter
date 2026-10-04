import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } =
		await import('../../routes/[[lang]]/admin/support/test-fixtures/translation');
	const { default: T } =
		await import('../../routes/[[lang]]/admin/support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
vi.mock('$app/state', () => ({
	page: { url: new URL('https://example.com/en/app'), params: { lang: 'en' }, data: {} }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit', () => ({
	useCustomer: () => ({ customer: { products: [] }, openBillingPortal: vi.fn() }),
	useAutumnOperation: () => ({ execute: vi.fn(), isLoading: false, error: null })
}));
vi.mock('$lib/components/billing', () => ({
	useBillingCheckout: () => ({ isUsable: true, isLoading: false, start: vi.fn() })
}));
vi.mock('$lib/auth-client', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import { useDictionary } from '../../routes/[[lang]]/admin/support/test-fixtures/translation';
import NavUserIdentityHarness from './test-fixtures/NavUserIdentityHarness.svelte';

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	// The sidebar reads the viewport and observes its own size.
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {}
	}));
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
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

/** Opens the user menu and returns the initials of every avatar on screen. */
async function avatarInitials(user: { name: string; email: string; avatar: string }) {
	component = mount(NavUserIdentityHarness, { target: document.body, props: { user } });
	await tick();
	document
		.getElementById('user-menu-trigger')!
		.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	return vi.waitFor(() => {
		const initials = [...document.querySelectorAll('[data-slot="avatar-fallback"]')].map((node) =>
			node.textContent?.trim()
		);
		expect(initials).toHaveLength(2);
		return initials;
	});
}

it('shows the same name initials on the trigger and in the open menu', async () => {
	const initials = await avatarInitials({
		name: 'Grace Brewster Hopper',
		email: 'grace@example.com',
		avatar: ''
	});

	expect(initials).toEqual(['GH', 'GH']);
});

it('falls back to the email initial on both avatars without a name', async () => {
	const initials = await avatarInitials({ name: '', email: 'visitor@example.com', avatar: '' });

	expect(initials).toEqual(['V', 'V']);
});
