import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
const calls = vi.hoisted(() => ({ claim: vi.fn(), replace: vi.fn() }));
vi.mock('$lib/utils/passkey-nudge', () => ({
	claimPasskeyNudge: calls.claim,
	deferPasskeyNudge: vi.fn()
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isLoading: false, isAuthenticated: true })
}));
vi.mock('$app/state', () => ({
	page: { params: { lang: 'en' }, url: new URL('https://example.com/en/passkey-setup') }
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import PasskeySetup from './+page.svelte';

let component: ReturnType<typeof mount> | undefined;
let resolveEligibility: (value: null) => void;
const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

beforeEach(async () => {
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { ...window.location, replace: calls.replace }
	});
	calls.claim.mockReturnValue(new Promise<null>((resolve) => (resolveEligibility = resolve)));
	type Props = { data: { destination: string } };
	component = mount(ChatTestProvider<Props>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: PasskeySetup as Svelte.Component<Props>,
			contentProps: { data: { destination: '/en/app?tab=work#latest' } }
		}
	});
	await tick();
	await vi.waitFor(() => expect(calls.claim).toHaveBeenCalledOnce());
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	Object.defineProperty(window, 'location', locationDescriptor);
	vi.resetAllMocks();
});

it('continues to the requested destination when no offer is needed', async () => {
	resolveEligibility(null);
	await vi.waitFor(() => expect(calls.replace).toHaveBeenCalledWith('/en/app?tab=work#latest'));
});

it('does not navigate again after the visitor leaves during the eligibility check', async () => {
	await unmount(component!);
	component = undefined;
	resolveEligibility(null);
	await tick();
	expect(calls.replace).not.toHaveBeenCalled();
});
