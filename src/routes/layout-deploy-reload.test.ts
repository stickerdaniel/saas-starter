/**
 * The mounted root layout, driven through the navigation callback it registers.
 *
 * Once SvelteKit has seen a new deploy, the next in-app navigation loads a fresh
 * document instead of importing chunks the deploy may have deleted, unless a
 * file is still uploading. Providers and shells around the page are replaced by
 * a passthrough; the upload registry and the reload decision run for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as Tolgee from '@tolgee/svelte';
import type { BeforeNavigate } from '$app/navigation';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const state = vi.hoisted(() => ({
	updated: { current: false },
	beforeNavigate: [] as Array<(navigation: BeforeNavigate) => void>,
	passthrough: async () => ({
		default: (await import('#lib/components/test-fixtures/Passthrough.svelte')).default
	})
}));

vi.mock('$app/env', () => ({ browser: true, dev: false }));
vi.mock('$app/env/public', () => ({
	PUBLIC_POSTHOG_ALLOWED_HOSTS: undefined,
	PUBLIC_POSTHOG_API_KEY: undefined,
	PUBLIC_POSTHOG_HOST: undefined
}));
vi.mock('$app/navigation', () => ({
	beforeNavigate: (callback: (navigation: BeforeNavigate) => void) => {
		state.beforeNavigate.push(callback);
	},
	onNavigate: () => {}
}));
vi.mock('$app/state', () => ({
	navigating: { to: null },
	page: {
		route: { id: '/[[lang]]/(marketing)/pricing' },
		params: { lang: 'en' },
		url: new URL('https://example.com/en')
	},
	updated: state.updated
}));
vi.mock('#lib/auth-client.js', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('fontless/runtime', () => ({ preloads: [] }));
vi.mock('@tolgee/svelte', async (importOriginal) => {
	const { default: Passthrough } = await state.passthrough();
	return {
		...(await importOriginal<typeof Tolgee>()),
		T: Passthrough,
		TolgeeProvider: Passthrough
	};
});
vi.mock('#lib/components/ui/sonner/index.js', async () => ({
	Toaster: (await state.passthrough()).default
}));
vi.mock('#lib/components/app/app-auth-provider.svelte', () => state.passthrough());
vi.mock('#lib/components/app/app-autumn-provider.svelte', () => state.passthrough());
vi.mock('#lib/components/analytics/analytics-root.svelte', () => state.passthrough());
vi.mock('#lib/components/clock-skew-banner.svelte', () => state.passthrough());
vi.mock('#lib/components/authenticated/investigation-bar.svelte', () => state.passthrough());
vi.mock('#lib/components/billing/checkout-provider.svelte', () => state.passthrough());
vi.mock('#lib/components/global-search/global-search-shell.svelte', () => state.passthrough());
vi.mock('#lib/components/RouteProgress.svelte', () => state.passthrough());
vi.mock(
	'#lib/components/upload-guard-notice.svelte',
	() => import('./test-fixtures/UploadsProbe.svelte')
);

import { provided } from './test-fixtures/UploadsProbe.svelte';
import RootLayout from './+layout.svelte';

let component: ReturnType<typeof mount> | undefined;
let locationDescriptor: PropertyDescriptor | undefined;
let documentLoads: string[] = [];

/**
 * Runs every navigation callback the layout registered, as SvelteKit does, and
 * returns whether one of them cancelled the navigation.
 */
function navigate(from: string, to: string, type: BeforeNavigate['type'] = 'link'): boolean {
	if (state.beforeNavigate.length === 0) {
		throw new Error('The layout registered no beforeNavigate callback');
	}
	let cancelled = false;
	const navigation = {
		from: { url: new URL(from) },
		to: { url: new URL(to) },
		willUnload: false,
		type,
		cancel: () => {
			cancelled = true;
		}
	} as BeforeNavigate;
	for (const callback of state.beforeNavigate) callback(navigation);
	return cancelled;
}

beforeEach(() => {
	state.updated.current = false;
	state.beforeNavigate = [];
	// app.html installs the deploy recovery hook before the app starts.
	vi.stubGlobal('__deployRecovery', { hold: () => () => {} });
	// The clock-skew measurement waits for an idle period this test never gives it.
	vi.stubGlobal('requestIdleCallback', () => 0);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
	// `location.href` itself is not configurable; record assignments to it instead.
	locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
	documentLoads = [];
	const current = window.location.href;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			get href() {
				return current;
			},
			set href(value: string) {
				documentLoads.push(value);
			}
		}
	});
	component = mount(RootLayout, {
		target: document.body,
		props: { data: {}, children: () => {} } as unknown as Svelte.ComponentProps<typeof RootLayout>
	});
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe('navigation after a deploy', () => {
	it.each(['link', 'goto', 'popstate'] as const)(
		'loads the target as a new document after a deploy (%s)',
		(type) => {
			state.updated.current = true;
			navigate('https://example.com/en', 'https://example.com/en/pricing', type);
			expect(documentLoads).toEqual(['https://example.com/en/pricing']);
		}
	);

	it('stays a client navigation while no deploy is detected', () => {
		expect(navigate('https://example.com/en', 'https://example.com/en/pricing')).toBe(false);
		expect(documentLoads).toEqual([]);
	});

	it('keeps the document while a file is uploading', () => {
		state.updated.current = true;
		provided.uploads!.claim({});
		// Same page: the upload guard lets this navigation through, so only the
		// deploy reload could end the transfer.
		expect(navigate('https://example.com/en/app', 'https://example.com/en/app?thread=2')).toBe(
			false
		);
		expect(documentLoads).toEqual([]);
	});
});
