import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true }));

const mocks = vi.hoisted(() => ({
	page: {
		data: {
			lang: 'en',
			capabilitiesResolved: true,
			capabilities: {
				billing: { usable: false, reason: 'unavailable' as const },
				ai: { usable: false, reason: 'unavailable' as const }
			}
		},
		url: new URL('https://example.com/en')
	},
	urlState: undefined as unknown
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (callback: (value: { data: null; isPending: false }) => void) => {
				callback({ data: null, isPending: false });
				return () => {};
			}
		})
	}
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('$lib/components/customer-support/use-support-url-state.svelte.ts', () => ({
	useSupportUrlState: () => mocks.urlState
}));
vi.mock('$lib/chat', () => ({
	ChatAttachmentStore: class ChatAttachmentStore {},
	ChatUIContext: class ChatUIContext {
		dispose() {}
	}
}));
vi.mock('$lib/components/customer-support/feedback-widget.svelte', async () => ({
	default: (
		await import('$lib/components/customer-support/test-fixtures/CapabilityFeedbackWidget.svelte')
	).default
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import CustomerSupport from './customer-support.svelte';
import { supportContext, type SupportContext } from './support-context.svelte.ts';

type UrlEntry = { support: '' | 'open'; thread: string };

/**
 * Browser history under the widget's URL params. A write behaves like runed's
 * useSearchParams with pushHistory: it compares against the raw param, so
 * clearing one that is already absent still pushes an entry.
 */
class BrowserHistory {
	entries = $state<UrlEntry[]>([]);
	index = $state(0);

	constructor(initial: UrlEntry) {
		this.entries = [initial];
	}

	get current(): UrlEntry {
		return this.entries[this.index]!;
	}

	write<K extends keyof UrlEntry>(key: K, value: UrlEntry[K]): void {
		if (value !== '' && this.current[key] === value) return;
		this.entries = [...this.entries.slice(0, this.index + 1), { ...this.current, [key]: value }];
		this.index++;
	}

	back(): void {
		this.index--;
	}

	forward(): void {
		if (this.index < this.entries.length - 1) this.index++;
	}
}

let component: ReturnType<typeof mount> | undefined;
let history: BrowserHistory;
let client: ConvexClient;

function mountSupport(): SupportContext {
	const setContext = vi.spyOn(supportContext, 'set');
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: { client, content: CustomerSupport, contentProps: {} }
	});
	flushSync();
	return setContext.mock.calls[0]![0];
}

beforeEach(() => {
	history = new BrowserHistory({ support: 'open', thread: '' });
	mocks.urlState = {
		get support() {
			return history.current.support;
		},
		set support(value: UrlEntry['support']) {
			history.write('support', value);
		},
		get thread() {
			return history.current.thread;
		},
		set thread(value: string) {
			history.write('thread', value);
		}
	};
	client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => mocks.page.data.capabilities },
		onUpdate: vi.fn(() => () => {}),
		mutation: vi.fn(),
		query: vi.fn(async () => ({}))
	} as unknown as ConvexClient;
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe('customer support URL history', () => {
	it('follows browser Back to the list and Forward to the conversation again', async () => {
		const support = mountSupport();
		await vi.waitFor(() => expect(support.conversation.userId).toBeTruthy());

		support.selectThread('thread_a');
		flushSync();
		expect(history.current.thread).toBe('thread_a');
		expect(support.navigation.currentView).toBe('chat');

		history.back();
		flushSync();
		expect(support.navigation.currentView).toBe('overview');
		// Following history adds no entry, so Forward still leads to the conversation.
		expect(history.entries.map((entry) => entry.thread)).toEqual(['', 'thread_a']);
		expect(history.index).toBe(0);

		history.forward();
		await vi.waitFor(() => expect(support.navigation.currentView).toBe('chat'));
		expect(support.conversation.threadId).toBe('thread_a');
		expect(history.current.thread).toBe('thread_a');
		const threadChecks = vi
			.mocked(client.query)
			.mock.calls.filter(
				([reference, args]) =>
					getFunctionName(reference) === 'support/threads:getThread' &&
					(args as { threadId: string }).threadId === 'thread_a'
			);
		expect(threadChecks).toHaveLength(1);
	});
});
