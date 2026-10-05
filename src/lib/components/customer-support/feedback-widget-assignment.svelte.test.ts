import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as ConvexSvelte from 'convex-svelte';
import type { ConvexClient } from 'convex/browser';
import type { ChatUIContext } from '$lib/chat';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (callback: (value: { data: null }) => void) => {
				callback({ data: null });
				return () => {};
			}
		})
	}
}));
vi.mock('$lib/chat', () => ({ ChatRoot: () => {}, ChatMessages: () => {}, ChatInput: () => {} }));
vi.mock('./threads-overview.svelte', () => ({ default: () => {} }));
vi.mock('convex-svelte', async (importOriginal) => ({
	...(await importOriginal<typeof ConvexSvelte>()),
	useQuery: () => ({
		get data() {
			return thread;
		}
	})
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import FeedbackWidget from './feedback-widget.svelte';
import { SupportContext } from './support-context.svelte.ts';
import en from '../../../i18n/en.json';

type Assignment = { name: string; image: string | null };
let thread = $state<{ assignedAdmin?: Assignment | null } | null>();
let component: ReturnType<typeof mount> | undefined;

function mountWidget(cached?: Assignment) {
	const support = new SupportContext(() => false);
	support.selectThread('thread-a', undefined, true, cached);
	component = mount(ChatTestProvider<{ chatUIContext: ChatUIContext }>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: FeedbackWidget,
			supportThread: support,
			contentProps: {
				chatUIContext: {
					displayMessages: [],
					inputValue: '',
					setInputValue() {},
					loadDraft() {},
					clearAttachments() {},
					enterSelectedThread() {}
				} as unknown as ChatUIContext
			}
		}
	});
	flushSync();
	return support;
}

const title = () => document.querySelector('header h3')?.textContent;
const alice = { name: 'Alice', image: null };
const bob = { name: 'Bob', image: null };

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	thread = undefined;
	document.body.replaceChildren();
});

describe('live support assignment', () => {
	it('follows reassignment and removal while the widget stays mounted', () => {
		thread = { assignedAdmin: alice };
		mountWidget(alice);
		expect(title()).toBe('Alice');
		thread = { assignedAdmin: bob };
		flushSync();
		expect(title()).toBe('Bob');
		thread = { assignedAdmin: null };
		flushSync();
		expect(title()).toBe(en.support.header.support_team);
	});

	it('uses the selected thread preview only while its query is loading', () => {
		thread = undefined;
		const support = mountWidget(alice);
		expect(title()).toBe('Alice');
		thread = {};
		flushSync();
		expect(title()).toBe(en.support.header.support_team);
		thread = undefined;
		support.selectThread('thread-b', undefined, true, bob);
		flushSync();
		expect(title()).toBe('Bob');
		thread = null;
		flushSync();
		expect(title()).toBe(en.support.header.support_team);
	});
});
