import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as ConvexSvelte from 'convex-svelte';
import type { ConvexClient } from 'convex/browser';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('convex-svelte', async (importOriginal) => ({
	...(await importOriginal<typeof ConvexSvelte>()),
	usePaginatedQuery: () => ({
		results: threads,
		status: 'Exhausted',
		isLoading: false,
		error: undefined,
		loadMore() {}
	}),
	useQuery: () => ({ data: [], isLoading: false })
}));

import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import ThreadsOverview from './threads-overview.svelte';
import { SupportContext } from './support-context.svelte.ts';

const threads = [
	{ _id: 'thread-a', lastMessage: 'First question', lastMessageAt: 1, isHandedOff: false },
	{ _id: 'thread-b', lastMessage: 'Second question', lastMessageAt: 2, isHandedOff: false }
];
let component: ReturnType<typeof mount> | undefined;

function mountOverview() {
	const support = new SupportContext(() => false);
	support.conversation.setUserId('user-1');
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: ThreadsOverview,
			supportThread: support,
			contentProps: {}
		}
	});
	flushSync();
	return support;
}

const row = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
		button.textContent?.includes(name)
	);

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('threads overview focus', () => {
	it('returns focus to the row that opened the conversation', () => {
		const support = mountOverview();
		const second = row('Second question');
		second?.focus();
		second?.click();
		flushSync();
		second?.blur();

		support.goBack();
		flushSync();

		expect(document.activeElement).toBe(row('Second question'));
	});

	it('leaves focus that already sits on another control', () => {
		const support = mountOverview();
		row('Second question')?.click();
		flushSync();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		support.goBack();
		flushSync();

		expect(document.activeElement).toBe(outside);
	});
});
