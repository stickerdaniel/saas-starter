/**
 * The mounted sign-up page, driven through its real form.
 *
 * Better Auth's own client runs here; only its network answers are replaced.
 * A refused request reaches the page the way the installed client hands it
 * over, resolved with `error` set rather than thrown.
 *
 * Better Auth's network, the session hook, and the shared auth-flow email are
 * the only replaced collaborators. Validation, URL helpers, last-method state,
 * and the Convex query all run for real.
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

const state = await vi.hoisted(async () => {
	const { SvelteURL } = await vi.importActual<typeof SvelteReactivity>(
		'../../../../../node_modules/svelte/src/reactivity/index-client.js'
	);
	return {
		SvelteURL,
		page: {
			url: new SvelteURL('https://example.com/de/signup'),
			params: { lang: 'de' },
			data: { lang: 'de' }
		},
		auth: { isAuthenticated: false, isLoading: false },
		/** Answers every request Better Auth's client sends, by path. */
		network: vi.fn<(path: string) => Promise<Response>>()
	};
});

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('#lib/auth-client.js', async () => {
	const { createAuthClient } = await import('better-auth/client');
	return {
		authClient: createAuthClient({
			baseURL: 'https://example.com',
			fetchOptions: {
				customFetchImpl: async (input: string | URL | Request) =>
					state.network(new URL(input instanceof Request ? input.url : input).pathname)
			}
		})
	};
});
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({ useAuth: () => state.auth }));
vi.mock('#lib/hooks/auth-flow.svelte.ts', () => ({
	authFlowContext: { get: () => ({ email: '' }), set: () => {} }
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('runed/kit', () => ({
	useSearchParams: () => ({
		get redirectTo() {
			return state.page.url.searchParams.get('redirectTo') ?? '';
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

import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import {
	clearLastSuccessfulAuthMethod,
	clearPendingOAuthProvider,
	pendingOAuthProvider
} from '#lib/hooks/last-auth-method.svelte.ts';
import SignUpPage from './+page.svelte';

type PageProps = { data: { oauthProviders: { google: boolean; github: boolean } } };

const originalElementAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
let component: ReturnType<typeof mount> | undefined;

async function renderSignUp(): Promise<void> {
	const client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => undefined },
		onUpdate: vi.fn(() => () => {}),
		mutation: vi.fn(),
		query: vi.fn()
	} as unknown as ConvexClient;
	component = mount(ChatTestProvider<PageProps>, {
		target: document.body,
		props: {
			client,
			content: SignUpPage as unknown as Svelte.Component<PageProps>,
			contentProps: { data: { oauthProviders: { google: true, github: true } } }
		}
	});
	await tick();
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

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function alertText(): string {
	return document.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
}

/** Lets a settled network answer travel through Better Auth's client to the page. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await tick();
}

beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
	state.page.url = new state.SvelteURL('https://example.com/de/signup');
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
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	return () => logged.mockRestore();
});

afterEach(async () => {
	try {
		if (component) await unmount(component);
		component = undefined;
		document.body.replaceChildren();
		clearLastSuccessfulAuthMethod();
		clearPendingOAuthProvider();
		vi.clearAllMocks();
	} finally {
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

describe('sign-up page', () => {
	it('shows the verification step once the account is created', async () => {
		state.network.mockResolvedValue(
			Response.json({
				token: null,
				user: { id: 'user-a', email: 'ada@example.com', name: 'Ada', emailVerified: false }
			})
		);
		await renderSignUp();

		type(fieldLabelled(en.auth.signin.name_label), 'Ada');
		type(fieldLabelled(en.auth.signin.email_label), 'ada@example.com');
		type(fieldLabelled(en.auth.signin.password_label), 'Correct horse 42');
		await tick();
		button(en.auth.signin.button_signup).click();

		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="signup-verification-step"]')).not.toBeNull()
		);
		expect(state.network).toHaveBeenCalledWith('/api/auth/sign-up/email');
		expect(document.body.textContent).toContain('ada@example.com');
	});

	it.each([
		{
			status: 400,
			response: () =>
				Response.json({ code: 'VALIDATION_ERROR', message: 'Invalid body' }, { status: 400 })
		},
		{ status: 503, response: () => new Response('Service Unavailable', { status: 503 }) }
	])('reports a $status OAuth start and lets the visitor try again', async ({ response }) => {
		state.network.mockResolvedValue(response());
		await renderSignUp();

		button(en.auth.signin.oauth_github).click();

		await vi.waitFor(() => expect(alertText()).toBe(en.auth.messages.oauth_failed));
		expect(state.network).toHaveBeenCalledWith('/api/auth/sign-in/social');
		expect(pendingOAuthProvider.current).toBeNull();
		expect(button(en.auth.signin.oauth_github).disabled).toBe(false);
		expect(button(en.auth.signin.oauth_google).disabled).toBe(false);
		expect(button(en.auth.signin.button_signup).disabled).toBe(false);
	});

	it('leaves a newer attempt alone when an earlier one fails after the visitor left', async () => {
		let refuseFirst!: (response: Response) => void;
		state.network
			.mockReturnValueOnce(new Promise((resolve) => (refuseFirst = resolve)))
			.mockReturnValueOnce(new Promise(() => {}));
		await renderSignUp();
		button(en.auth.signin.oauth_github).click();
		await vi.waitFor(() => expect(state.network).toHaveBeenCalledOnce());
		await unmount(component!);
		document.body.replaceChildren();

		await renderSignUp();
		button(en.auth.signin.oauth_github).click();
		await vi.waitFor(() => expect(state.network).toHaveBeenCalledTimes(2));
		refuseFirst(new Response('Service Unavailable', { status: 503 }));
		await settle();

		expect(pendingOAuthProvider.current).toBe('github');
		expect(alertText()).toBe('');
		expect(button(en.auth.signin.oauth_github).disabled).toBe(true);
	});
});
