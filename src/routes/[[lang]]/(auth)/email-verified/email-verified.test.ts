import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.hoisted(() => {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (media: string) => ({
			matches: false,
			media,
			addEventListener() {},
			removeEventListener() {}
		})
	});
});
const calls = vi.hoisted(() => ({ claim: vi.fn(), skip: vi.fn() }));
vi.mock('#lib/utils/passkey-nudge.js', () => ({
	claimPasskeyNudge: calls.claim,
	deferPasskeyNudge: vi.fn(async () => {})
}));
vi.mock('#lib/components/auth/passkey-offer-navigation.js', () => ({
	skipToDestination: calls.skip,
	continueAfterEnrollment: vi.fn()
}));
vi.mock('#lib/auth-client.js', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (listener: (snapshot: unknown) => void) => {
				listener({ data: { session: { id: 'session-a' } } });
				return () => {};
			}
		})
	}
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isLoading: false, isAuthenticated: true })
}));
vi.mock('runed/kit', () => ({
	useSearchParams: () => ({ redirectTo: '/en/app?tab=work#latest' })
}));
vi.mock('$app/state', () => ({
	page: { params: { lang: 'en' }, url: new URL('https://example.com/en/email-verified') }
}));

import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import EmailVerified from './+page.svelte';

const DESTINATION = '/en/app?tab=work#latest';
let component: ReturnType<typeof mount> | undefined;
let navigations: string[] = [];
const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;

beforeEach(() => {
	navigations = [];
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			set href(value: string) {
				navigations.push(value);
			}
		}
	});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	Object.defineProperty(window, 'location', locationDescriptor);
	vi.resetAllMocks();
});

async function render(): Promise<void> {
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: EmailVerified as Svelte.Component<Record<string, never>>,
			contentProps: {}
		}
	});
	await tick();
}

function heading(): string {
	return document.querySelector('h1')?.textContent ?? '';
}

it('turns this card into the passkey offer for an account that gets one', async () => {
	calls.claim.mockResolvedValue({
		userId: 'user-a',
		sessionId: 'session-a',
		name: 'Ada Example',
		email: 'ada@example.com'
	});
	await render();
	expect(heading()).toContain(en.auth.verification.verified_title);

	await vi.waitFor(() => expect(heading()).toContain(en.auth.passkey_nudge.title), {
		timeout: 3000
	});
	expect(navigations).toEqual([]);

	const notNow = [...document.querySelectorAll('button')].find(
		(element) => element.textContent?.trim() === en.auth.passkey_nudge.not_now
	)!;
	notNow.click();
	await vi.waitFor(() => expect(calls.skip).toHaveBeenCalledWith(DESTINATION));
});

it('takes every other account straight to the destination', async () => {
	calls.claim.mockResolvedValue(null);
	await render();
	await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]), { timeout: 3000 });
	expect(calls.claim).toHaveBeenCalledOnce();
});
