import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('@tolgee/svelte', async () => {
	const { translation } =
		await import('../../../routes/[[lang]]/admin/support/test-fixtures/translation');
	return { getTranslate: () => ({ t: translation }) };
});
const navigation = vi.hoisted(() => ({ listeners: [] as Array<() => void> }));
vi.mock('$app/navigation', () => ({
	afterNavigate: (listener: () => void) => navigation.listeners.push(listener)
}));
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('#lib/hooks/is-mobile.svelte.ts', () => ({
	IsMobile: class {
		current = true;
	}
}));
vi.mock('./authenticated-sidebar.svelte', () => import('./test-fixtures/MobileSidebar.svelte'));
vi.mock('./authenticated-header.svelte', () => import('./test-fixtures/Empty.svelte'));
vi.mock('./auth-connection-fallback.svelte', () => import('./test-fixtures/Empty.svelte'));
vi.mock(
	'#lib/components/auth/sidebar-passkey-offer.svelte',
	() => import('./test-fixtures/Empty.svelte')
);
vi.mock('#lib/components/auth/passkey-enrollment.svelte.ts', () => ({
	PasskeyNudgeClaim: class {
		offer = null;
	}
}));

import { useDictionary } from '../../../routes/[[lang]]/admin/support/test-fixtures/translation';
import HouseIcon from '@lucide/svelte/icons/house';
import AuthenticatedLayout from './authenticated-layout.svelte';

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	navigation.listeners.length = 0;
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

const sheet = () => document.querySelector('[data-mobile="true"]');

function navigate() {
	for (const listener of navigation.listeners) listener();
	flushSync();
}

describe('authenticated layout on a phone', () => {
	it('closes the open sidebar sheet after a navigation', async () => {
		component = mount(AuthenticatedLayout, {
			target: document.body,
			props: {
				sidebarConfig: { header: { icon: HouseIcon, href: '/en/app', title: 'App' }, navItems: [] },
				user: { name: 'Visitor', email: 'visitor@example.com' },
				routePrefix: 'app',
				rootLabel: 'App'
			}
		});
		flushSync();
		expect(sheet()).toBeNull();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
		flushSync();
		await vi.waitFor(() => expect(sheet()?.getAttribute('data-state')).toBe('open'));

		navigate();
		await vi.waitFor(() => expect(sheet()).toBeNull());
	});
});
