// @vitest-environment node

/**
 * The Page URL link in the admin details panel, for rows stored before page
 * metadata was normalized. Those rows still hold whatever the visitor's
 * browser sent, so the link has to be reduced where it is rendered.
 */

import { createRequire } from 'node:module';
import type { ConvexClient } from 'convex/browser';
import type * as ConvexSvelte from 'convex-svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pageUrl: undefined as string | undefined }));

vi.mock('$app/state', () => ({
	page: { url: new URL('https://app.example.com/en/admin/support'), params: {}, data: {} }
}));
vi.mock('convex-svelte', async (importOriginal) => ({
	...(await importOriginal<typeof ConvexSvelte>()),
	useQuery: (query: FunctionReference<'query'>) => ({
		data:
			getFunctionName(query) === 'admin/support/queries:getThreadForAdmin'
				? {
						threadId: 'thread_1',
						userId: 'anon_legacy',
						supportMetadata: { status: 'open', pageUrl: state.pageUrl }
					}
				: undefined,
		error: undefined,
		isLoading: false
	})
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import ThreadDetails from './thread-details.svelte';

type Window = { document: Document; close(): void };

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html: string, options: { url: string }) => { window: Window };
};

const ORIGIN = 'https://app.example.com';
const openWindows: Window[] = [];

afterEach(() => {
	for (const window of openWindows.splice(0)) window.close();
});

type Props = { threadId: string };

/** The panel as served for a thread whose stored page URL is `pageUrl`. */
function renderDetails(pageUrl: string): Document {
	state.pageUrl = pageUrl;
	const { body } = render(ChatTestProvider<Props>, {
		props: {
			// Nothing subscribes during a server render.
			client: {} as ConvexClient,
			content: ThreadDetails as unknown as Component<Props>,
			contentProps: { threadId: 'thread_1' }
		}
	});
	const { window } = new JSDOM(`<!doctype html><body>${body}</body>`, {
		url: `${ORIGIN}/en/admin/support`
	});
	openWindows.push(window);
	return window.document;
}

function pageUrlLinks(document: Document): HTMLAnchorElement[] {
	return [...document.querySelectorAll('a')].filter((link) =>
		link.textContent?.includes('/en/pricing')
	);
}

describe('admin support Page URL', () => {
	it('links a foreign absolute URL only as a path on this site', () => {
		const document = renderDetails('https://other.example/en/pricing?ref=x#y');
		const [link] = pageUrlLinks(document);

		expect(link).toBeDefined();
		expect(link!.href).toBe(`${ORIGIN}/en/pricing`);
	});

	it('renders no link for metadata that is not a web page', () => {
		const document = renderDetails('javascript:alert(1)');

		expect(document.body.textContent).not.toContain('javascript:');
		expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
		expect(document.body.textContent).toContain('Status');
	});
});
