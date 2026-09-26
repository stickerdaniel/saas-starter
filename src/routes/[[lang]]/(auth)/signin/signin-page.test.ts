/**
 * The mounted sign-in page, driven through its real form.
 *
 * Better Auth reads `callbackURL` twice. On a rejected password sign-in it is
 * the destination baked into the fresh verification link, and on success its
 * client navigates to it. Both readings, and the page's own navigation, have to
 * land on the destination the visitor asked for once it has been validated.
 * The Better Auth side of that contract runs against a real instance in
 * src/lib/utils/__tests__/callback-url.contract.test.ts and
 * src/lib/convex/__tests__/verificationRecovery.test.ts; this file observes what
 * the page hands to it and where the page itself navigates.
 *
 * Better Auth, the session hook, and the shared auth-flow email are the only
 * replaced collaborators. Validation, URL helpers, last-method state, and the
 * Convex query all run for real.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as SvelteReactivity from 'svelte/reactivity';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

// Svelte's motion module builds a MediaQuery while the field components are
// imported, before any hook could install this.
const originalMatchMedia = vi.hoisted(() => {
	const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent: () => false
		})
	});
	return descriptor;
});

type AuthError = { code: string; message: string; status: number };
type AuthResult = { data: unknown; error: AuthError | null };
type EmailSignIn = (
	body: { email: string; password: string; callbackURL: string },
	options: { onError: (context: { error: AuthError }) => void }
) => Promise<AuthResult>;
type SocialSignIn = (body: {
	provider: string;
	callbackURL: string;
	errorCallbackURL: string;
}) => Promise<AuthResult>;

const state = await vi.hoisted(async () => {
	// Reactive like SvelteKit's own `page.url`, so a rewrite of the query is
	// seen by everything that derives from it.
	const { SvelteURL } = await vi.importActual<typeof SvelteReactivity>(
		'../../../../../node_modules/svelte/src/reactivity/index-client.js'
	);
	return {
		SvelteURL,
		page: {
			url: new SvelteURL('https://example.com/de/signin'),
			params: { lang: 'de' },
			data: { lang: 'de' }
		},
		auth: { isAuthenticated: false, isLoading: false },
		/** Overrides what `useSearchParams` reports; otherwise it mirrors the URL. */
		cachedDestination: null as string | null,
		signIn: {
			email: vi.fn<EmailSignIn>(),
			social: vi.fn<SocialSignIn>(),
			passkey: vi.fn<() => Promise<AuthResult>>()
		}
	};
});

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$lib/auth-client', () => ({ authClient: { signIn: state.signIn } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({ useAuth: () => state.auth }));
vi.mock('$lib/hooks/auth-flow.svelte.ts', () => ({
	authFlowContext: { get: () => ({ email: '' }), set: () => {} }
}));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('runed/kit', () => ({
	useSearchParams: () => ({
		get redirectTo() {
			return state.cachedDestination ?? state.page.url.searchParams.get('redirectTo') ?? '';
		},
		get error() {
			return state.page.url.searchParams.get('error') ?? '';
		},
		get error_description() {
			return state.page.url.searchParams.get('error_description') ?? '';
		},
		update(values: Record<string, string>) {
			for (const [key, value] of Object.entries(values)) {
				if (value) state.page.url.searchParams.set(key, value);
				else state.page.url.searchParams.delete(key);
			}
		}
	})
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import {
	clearLastSuccessfulAuthMethod,
	clearPendingOAuthProvider
} from '$lib/hooks/last-auth-method.svelte.ts';
import SignInPage from './+page.svelte';

const DESTINATION = '/de/app/settings?tab=billing#invoices';

type PageProps = { data: { oauthProviders: { google: boolean; github: boolean } } };

const originalElementAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
let locationDescriptor: PropertyDescriptor | undefined;
let navigations: string[] = [];
let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

/** Where the page asks the browser to go. `href` itself is not configurable. */
function recordNavigation(): void {
	locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
	const current = window.location.href;
	navigations = [];
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			get href() {
				return current;
			},
			set href(value: string) {
				navigations.push(value);
			}
		}
	});
}

async function renderSignIn(search: string, { authenticated = false } = {}): Promise<void> {
	state.page.url = new state.SvelteURL(`https://example.com/de/signin${search}`);
	state.auth.isAuthenticated = authenticated;
	component = mount(ChatTestProvider<PageProps>, {
		target: document.body,
		props: {
			client,
			content: SignInPage as unknown as Svelte.Component<PageProps>,
			contentProps: { data: { oauthProviders: { google: true, github: false } } }
		}
	});
	await tick();
}

function withDestination(destination: string): string {
	return `?redirectTo=${encodeURIComponent(destination)}`;
}

function fieldLabelled(text: string): HTMLInputElement {
	const label = [...document.querySelectorAll('label')].find(
		(element) => element.textContent?.trim() === text
	);
	return document.getElementById(label!.htmlFor) as HTMLInputElement;
}

function button(name: string): HTMLButtonElement {
	return [...document.querySelectorAll('button')].find(
		(element) => element.textContent?.trim() === name
	)!;
}

function link(name: string): URL {
	const anchor = [...document.querySelectorAll('a')].find(
		(element) => element.textContent?.trim() === name
	)!;
	return new URL(anchor.getAttribute('href')!, 'https://example.com');
}

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitPassword(): Promise<void> {
	type(fieldLabelled(en.auth.signin.email_label), 'ada@example.com');
	type(fieldLabelled(en.auth.signin.password_label), 'correct horse battery');
	await tick();
	button(en.auth.signin.button_signin).click();
	await vi.waitFor(() => expect(state.signIn.email).toHaveBeenCalledOnce());
}

/** What the page handed to Better Auth's password sign-in. */
function emailRequest(): Parameters<EmailSignIn>[0] {
	expect(state.signIn.email).toHaveBeenCalledOnce();
	return state.signIn.email.mock.lastCall![0];
}

/** What the page handed to Better Auth's social sign-in. */
async function socialRequest(): Promise<Parameters<SocialSignIn>[0]> {
	await vi.waitFor(() => expect(state.signIn.social).toHaveBeenCalledOnce());
	return state.signIn.social.mock.lastCall![0];
}

/** The destination an auth-page URL carries, or null for the bare page. */
function carried(url: string): { page: string; destination: string | null } {
	const parsed = new URL(url, 'https://example.com');
	return { page: parsed.pathname, destination: parsed.searchParams.get('redirectTo') };
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({
			cancel: vi.fn(),
			currentTime: 0,
			effect: null,
			onfinish: null,
			playState: 'finished'
		}))
	});
	client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => undefined },
		onUpdate: vi.fn(() => () => {}),
		mutation: vi.fn(),
		query: vi.fn()
	} as unknown as ConvexClient;
	state.signIn.email.mockResolvedValue({ data: { redirect: false }, error: null });
	state.signIn.social.mockResolvedValue({
		data: { url: 'https://accounts.google.com/o/oauth2', redirect: true },
		error: null
	});
	state.signIn.passkey.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
	recordNavigation();
});

afterEach(async () => {
	try {
		if (component) await unmount(component);
		component = undefined;
		document.body.replaceChildren();
		clearLastSuccessfulAuthMethod();
		clearPendingOAuthProvider();
		state.cachedDestination = null;
		vi.clearAllMocks();
	} finally {
		if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
		if (originalElementAnimate) {
			Object.defineProperty(Element.prototype, 'animate', originalElementAnimate);
		} else {
			Reflect.deleteProperty(Element.prototype, 'animate');
		}
	}
});

afterAll(() => {
	if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
	else Reflect.deleteProperty(window, 'matchMedia');
});

describe('sign-in page destination', () => {
	it('carries the destination through a password sign-in and then navigates to it', async () => {
		await renderSignIn(withDestination(DESTINATION));

		await submitPassword();

		const { callbackURL } = emailRequest();
		expect(carried(callbackURL)).toEqual({ page: '/de/signin', destination: DESTINATION });
		await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]));
	});

	it('keeps the visitor on the form when the password is rejected', async () => {
		state.signIn.email.mockImplementation(async (_body, options) => {
			const error = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid', status: 401 };
			options.onError({ error });
			return { data: null, error };
		});
		await renderSignIn(withDestination(DESTINATION));

		await submitPassword();

		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain(
				en.auth.messages.invalid_credentials
			)
		);
		expect(navigations).toEqual([]);
	});

	it('brings a Google sign-in back to the same destination', async () => {
		await renderSignIn(withDestination(DESTINATION));

		button(en.auth.signin.oauth_google).click();

		const { provider, callbackURL, errorCallbackURL } = await socialRequest();
		expect(provider).toBe('google');
		expect(carried(callbackURL)).toEqual({ page: '/de/signin', destination: DESTINATION });
		expect(carried(errorCallbackURL)).toEqual({ page: '/de/signin', destination: DESTINATION });
	});

	it('forwards the destination to the recovery and signup links', async () => {
		await renderSignIn(withDestination(DESTINATION));

		for (const name of [en.auth.signin.forgot_password, en.auth.signin.link_signup]) {
			const target = link(name);
			expect(target.searchParams.get('redirectTo'), name).toBe(DESTINATION);
		}
		expect(link(en.auth.signin.forgot_password).pathname).toBe('/de/forgot-password');
		expect(link(en.auth.signin.link_signup).pathname).toBe('/de/signup');
	});

	/**
	 * The `useSearchParams` cache fills only in the browser, so a page reading it
	 * would ship server-rendered links without a destination. Here it disagrees
	 * with the address bar instead, which makes the wrong source visible after
	 * mounting too.
	 */
	it('reads the destination from the address bar when the params cache disagrees', async () => {
		state.cachedDestination = '/de/billing?from=params-cache';
		await renderSignIn(withDestination(DESTINATION));

		await submitPassword();

		const { callbackURL } = emailRequest();
		expect(carried(callbackURL).destination).toBe(DESTINATION);
		expect(link(en.auth.signin.link_signup).searchParams.get('redirectTo')).toBe(DESTINATION);
		await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]));
	});

	it('follows the address bar when its destination changes after mounting', async () => {
		await renderSignIn(withDestination('/de/app?from=original'));

		state.page.url.searchParams.set('redirectTo', DESTINATION);
		await tick();

		for (const name of [en.auth.signin.forgot_password, en.auth.signin.link_signup]) {
			expect(link(name).searchParams.get('redirectTo'), name).toBe(DESTINATION);
		}
		await submitPassword();
		expect(carried(emailRequest().callbackURL).destination).toBe(DESTINATION);
		await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]));
	});

	it('sends an off-site destination nowhere, not even into the OAuth failure URL', async () => {
		await renderSignIn(withDestination('//evil.example/steal'));

		expect(link(en.auth.signin.forgot_password).search).toBe('');
		expect(link(en.auth.signin.link_signup).search).toBe('');

		button(en.auth.signin.oauth_google).click();
		const { callbackURL, errorCallbackURL } = await socialRequest();
		expect(carried(callbackURL)).toEqual({ page: '/de/signin', destination: '/de/app' });
		expect(errorCallbackURL).toBe('/de/signin');

		await submitPassword();
		expect(carried(emailRequest().callbackURL)).toEqual({
			page: '/de/signin',
			destination: '/de/app'
		});
		await vi.waitFor(() => expect(navigations).toEqual(['/de/app']));
	});

	/**
	 * A same-origin path the page will not navigate to still rides along in the
	 * OAuth failure URL. The page it returns to narrows it again, so narrowing
	 * it here as well would only discard links that work.
	 */
	it('keeps a destination it refuses only as data in the OAuth failure URL', async () => {
		await renderSignIn(withDestination('/favicon.ico'));

		expect(link(en.auth.signin.link_signup).search).toBe('');

		button(en.auth.signin.oauth_google).click();
		const { callbackURL, errorCallbackURL } = await socialRequest();
		expect(carried(callbackURL)).toEqual({ page: '/de/signin', destination: '/de/app' });
		expect(carried(errorCallbackURL)).toEqual({ page: '/de/signin', destination: '/favicon.ico' });

		await submitPassword();
		await vi.waitFor(() => expect(navigations).toEqual(['/de/app']));
	});
});

describe('sign-in page holding a signed-in visitor', () => {
	const heldSearch = `${withDestination(DESTINATION)}&error=TOKEN_EXPIRED`;

	it('reports a failed verification link instead of navigating away', async () => {
		await renderSignIn(heldSearch, { authenticated: true });

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			en.auth.messages.invalid_token
		);
		// The effect that clears the code has run; the hold must outlive it.
		await vi.waitFor(() => expect(state.page.url.searchParams.has('error')).toBe(false));
		await tick();
		expect(navigations).toEqual([]);
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			en.auth.messages.invalid_token
		);
	});

	it('lets the visitor through once they sign in with a passkey here', async () => {
		await renderSignIn(heldSearch, { authenticated: true });

		button(en.auth.signin.passkey_button).click();

		await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]));
		await tick();
		expect(navigations).toEqual([DESTINATION]);
	});

	it('navigates a visitor who arrives signed in without a failed link', async () => {
		await renderSignIn(withDestination(DESTINATION), { authenticated: true });

		await vi.waitFor(() => expect(navigations).toEqual([DESTINATION]));
	});
});
