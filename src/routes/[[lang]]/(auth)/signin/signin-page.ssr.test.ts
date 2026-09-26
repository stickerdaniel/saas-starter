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

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document; close(): void } };
};

const openWindows: Array<{ close(): void }> = [];

afterEach(() => {
	for (const window of openWindows.splice(0)) window.close();
});

const DESTINATION = '/de/app/settings?tab=billing#invoices';

type PageProps = { data: { oauthProviders: { google: boolean; github: boolean } } };

function serverRender(search: string, { authenticated = false } = {}): Document {
	state.page.url = new URL(`https://example.com/de/signin${search}`);
	state.auth.isAuthenticated = authenticated;
	const { body } = render(ChatTestProvider<PageProps>, {
		props: {
			// Nothing subscribes during a server render.
			client: {} as ConvexClient,
			content: SignInPage as unknown as Component<PageProps>,
			contentProps: { data: { oauthProviders: { google: true, github: false } } }
		}
	});
	const { window } = new JSDOM(body);
	openWindows.push(window);
	return window.document;
}

function linkIn(document: Document, name: string): URL {
	const anchor = [...document.querySelectorAll('a')].find(
		(element) => element.textContent?.trim() === name
	)!;
	return new URL(anchor.getAttribute('href')!, 'https://example.com');
}

describe('server-rendered sign-in page', () => {
	it('puts the destination from the request URL into the first-paint links', () => {
		const document = serverRender(`?redirectTo=${encodeURIComponent(DESTINATION)}`);

		for (const name of [en.auth.signin.forgot_password, en.auth.signin.link_signup]) {
			expect(linkIn(document, name).searchParams.get('redirectTo'), name).toBe(DESTINATION);
		}
	});

	it('reports a failed verification link in the first paint', () => {
		const document = serverRender(
			`?redirectTo=${encodeURIComponent(DESTINATION)}&error=TOKEN_EXPIRED`,
			{ authenticated: true }
		);

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			en.auth.messages.invalid_token
		);
	});
});
