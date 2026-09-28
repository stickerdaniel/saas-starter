// @vitest-environment node

/**
 * The sign-in page as the server renders it, before any browser code runs.
 *
 * A visitor whose browser never hydrates, or who acts before it does, sees
 * only this HTML. Its links and its report of a failed verification link have
 * to come from the request URL. `useSearchParams` stays real here: its cache
 * fills only in the browser, so a page that reads from it renders without the
 * destination on the server and nothing after mounting reveals that.
 */

import { createRequire } from 'node:module';
import type { ConvexClient } from 'convex/browser';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../i18n/en.json';

const state = vi.hoisted(() => ({
	page: {
		url: new URL('https://example.com/de/signin'),
		params: { lang: 'de' },
		data: { lang: 'de' }
	},
	auth: { isAuthenticated: false, isLoading: false }
}));

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$lib/auth-client', () => ({ authClient: { signIn: {} } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({ useAuth: () => state.auth }));
vi.mock('$lib/hooks/auth-flow.svelte.ts', () => ({
	authFlowContext: { get: () => ({ email: '' }), set: () => {} }
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import SignInPage from './+page.svelte';

type Window = {
	document: Document;
	getComputedStyle(element: Element): CSSStyleDeclaration;
	close(): void;
};

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: Window };
};

const openWindows: Window[] = [];

afterEach(() => {
	for (const window of openWindows.splice(0)) window.close();
});

const DESTINATION = '/de/app/settings?tab=billing#invoices';

type PageProps = { data: { oauthProviders: { google: boolean; github: boolean } } };

/**
 * The whole document, head included, parsed the way a browser without
 * JavaScript parses it: `<noscript>` content becomes real markup, and its
 * styles apply. The component's own stylesheet is not part of a server render,
 * so what is shown here is decided by the page's no-script styles alone.
 */
function serverRender(search: string, { authenticated = false } = {}): Window {
	state.page.url = new URL(`https://example.com/de/signin${search}`);
	state.auth.isAuthenticated = authenticated;
	const { head, body } = render(ChatTestProvider<PageProps>, {
		props: {
			// Nothing subscribes during a server render.
			client: {} as ConvexClient,
			content: SignInPage as unknown as Component<PageProps>,
			contentProps: { data: { oauthProviders: { google: true, github: false } } }
		}
	});
	const { window } = new JSDOM(
		`<!doctype html><html><head>${head}</head><body>${body}</body></html>`
	);
	openWindows.push(window);
	return window;
}

/** Rendered and neither hidden nor left out of the layout. */
function isShown(window: Window, element: Element): boolean {
	if (window.getComputedStyle(element).visibility === 'hidden') return false;
	for (let node: Element | null = element; node; node = node.parentElement) {
		if (window.getComputedStyle(node).display === 'none') return false;
	}
	return true;
}

function anchorsNamed(document: Document, name: string): HTMLAnchorElement[] {
	return [...document.querySelectorAll('a')].filter(
		(element) => element.textContent?.trim() === name
	);
}

function linkIn(document: Document, name: string): URL {
	return new URL(anchorsNamed(document, name)[0]!.getAttribute('href')!, 'https://example.com');
}

/** Where every rendered resume link leads, visible or not. */
function resumeTargets(document: Document): string[] {
	return anchorsNamed(document, en.auth.signin.button_resume).map((anchor) => {
		const target = new URL(anchor.getAttribute('href')!, 'https://example.com');
		return target.href;
	});
}

function shownResumeLinks(window: Window): HTMLAnchorElement[] {
	return anchorsNamed(window.document, en.auth.signin.button_resume).filter((anchor) =>
		isShown(window, anchor)
	);
}

function reportIn(document: Document): string | undefined {
	return document.querySelector('[role="alert"]')?.textContent?.trim();
}

describe('server-rendered sign-in page', () => {
	it('puts the destination from the request URL into the first-paint links', () => {
		const { document } = serverRender(`?redirectTo=${encodeURIComponent(DESTINATION)}`);

		for (const name of [en.auth.signin.forgot_password, en.auth.signin.link_signup]) {
			expect(linkIn(document, name).searchParams.get('redirectTo'), name).toBe(DESTINATION);
		}
	});

	it('reports a failed verification link in the first paint', () => {
		const { document } = serverRender(
			`?redirectTo=${encodeURIComponent(DESTINATION)}&error=TOKEN_EXPIRED`
		);

		expect(reportIn(document)).toBe(en.auth.messages.invalid_token);
		expect(resumeTargets(document)).toEqual([]);
	});

	/**
	 * The session proves nothing about the link's account, so the form stays,
	 * but "request a new one" is the wrong instruction for someone who may
	 * already be verified. The way on has to work without JavaScript too.
	 */
	it('lets a signed-in visitor holding a failed verification link go on', () => {
		const window = serverRender(
			`?redirectTo=${encodeURIComponent(DESTINATION)}&error=TOKEN_EXPIRED`,
			{ authenticated: true }
		);

		expect(reportIn(window.document)).toBe(en.auth.messages.invalid_token_signed_in);
		expect(resumeTargets(window.document).length).toBeGreaterThan(0);
		for (const target of resumeTargets(window.document)) {
			expect(target).toBe(new URL(DESTINATION, state.page.url.origin).href);
		}
		expect(shownResumeLinks(window)).toHaveLength(1);
		expect(window.document.querySelector('[data-testid="signin-button"]')).not.toBeNull();
	});

	it('sends a signed-in visitor on to the app without a usable destination', () => {
		const { document } = serverRender(
			`?redirectTo=${encodeURIComponent('//evil.example/steal')}&error=INVALID_TOKEN`,
			{ authenticated: true }
		);

		expect(resumeTargets(document).length).toBeGreaterThan(0);
		for (const target of resumeTargets(document)) {
			expect(target).toBe(new URL('/de/app', state.page.url.origin).href);
		}
	});

	// Better Auth reports an expired reset link with the same code, and the hook
	// marks it. Nothing about a reset link is settled by being signed in.
	it('keeps the report for a failed reset link even when signed in', () => {
		const { document } = serverRender(
			`?redirectTo=${encodeURIComponent(DESTINATION)}&error=INVALID_TOKEN&link=reset`,
			{ authenticated: true }
		);

		expect(reportIn(document)).toBe(en.auth.messages.invalid_token);
		expect(resumeTargets(document)).toEqual([]);
	});

	it('replaces the unusable form with a way out when JavaScript is off', () => {
		const search = `?redirectTo=${encodeURIComponent(DESTINATION)}&error=TOKEN_EXPIRED`;
		const window = serverRender(search);
		const { document } = window;
		const shownText = (text: string) =>
			[...document.querySelectorAll('h1, p')].some(
				(element) => element.textContent?.trim() === text && isShown(window, element)
			);

		expect(shownText(en.auth.gate.noscript_title)).toBe(true);
		expect(shownText(en.auth.gate.noscript_description)).toBe(true);
		// Loading did not stall; there was nothing to load.
		expect(shownText(en.auth.gate.stalled_title)).toBe(false);

		// The form's controls are disabled until hydration, which never comes.
		const submit = document.querySelector<HTMLButtonElement>('[data-testid="signin-button"]')!;
		expect(submit.disabled).toBe(true);
		expect(isShown(window, submit)).toBe(false);
		expect(isShown(window, document.querySelector('input[type="email"]')!)).toBe(false);

		const reload = anchorsNamed(document, en.auth.gate.reload);
		expect(reload).toHaveLength(1);
		expect(isShown(window, reload[0]!)).toBe(true);
		expect(reload[0]!.getAttribute('href')).toBe(`/de/signin${search}`);
		expect(shownResumeLinks(window)).toEqual([]);
	});
});
