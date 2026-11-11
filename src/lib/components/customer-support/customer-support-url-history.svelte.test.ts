import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
// A support send reports the build its tab runs.
vi.mock('$app/env', () => ({ browser: true, version: 'test-build' }));

const mocks = vi.hoisted(() => ({
	page: {
		data: {
			lang: 'en',
			capabilitiesResolved: true,
			capabilities: {
				billing: { usable: false, reason: 'unavailable' as const },
				ai: { usable: false, reason: 'unavailable' } as {
					usable: boolean;
					reason: 'available' | 'unavailable';
				}
			}
		},
		url: new URL('https://example.com/en')
	},
	urlState: undefined as unknown
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('#lib/auth-client.js', () => ({
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
vi.mock('#lib/components/customer-support/use-support-url-state.svelte.ts', () => ({
	useSupportUrlState: () => mocks.urlState
}));
vi.mock('#lib/chat/index.js', () => ({
	ChatAttachmentStore: class ChatAttachmentStore {},
	ChatUIContext: class ChatUIContext {
		dispose() {}
	}
}));
vi.mock('#lib/components/customer-support/feedback-widget.svelte', async () => ({
	default: (
		await import('#lib/components/customer-support/test-fixtures/CapabilityFeedbackWidget.svelte')
	).default
}));

import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import CustomerSupport from './customer-support.svelte';
import { supportContext, type SupportContext } from './support-context.svelte.ts';
import en from '../../../i18n/en.json';

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
	mocks.page.data.capabilities.ai = { usable: false, reason: 'unavailable' };
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

	it('keeps each thread its own metadata across Back and Forward', async () => {
		const reads = {
			thread_human: {
				isHandedOff: true,
				assignedAdmin: { name: 'Alice', image: null },
				notificationEmail: 'notify@example.com'
			},
			thread_ai: { isHandedOff: false }
		};
		vi.mocked(client.query).mockImplementation(
			async (_reference, args) => reads[(args as { threadId: keyof typeof reads }).threadId]
		);
		const support = mountSupport();
		await vi.waitFor(() => expect(support.conversation.userId).toBeTruthy());
		const { conversation } = support;

		history.write('thread', 'thread_human');
		await vi.waitFor(() => expect(conversation.threadId).toBe('thread_human'));
		expect(conversation.isHandedOff).toBe(true);
		expect(conversation.assignedAdmin).toEqual({ name: 'Alice', image: null });
		expect(conversation.notificationEmail).toBe('notify@example.com');

		history.write('thread', 'thread_ai');
		await vi.waitFor(() => expect(conversation.threadId).toBe('thread_ai'));
		expect(conversation.isHandedOff).toBe(false);
		expect(conversation.assignedAdmin).toBeUndefined();
		expect(conversation.notificationEmail).toBeNull();

		history.back();
		await vi.waitFor(() => expect(conversation.threadId).toBe('thread_human'));
		expect(conversation.isHandedOff).toBe(true);
		expect(conversation.notificationEmail).toBe('notify@example.com');

		history.forward();
		await vi.waitFor(() => expect(conversation.threadId).toBe('thread_ai'));
		expect(conversation.isHandedOff).toBe(false);
		expect(conversation.assignedAdmin).toBeUndefined();
		expect(conversation.notificationEmail).toBeNull();
	});
});

describe('chatbar submit under URL history', () => {
	type WarmThread = { threadId: string; notificationEmail: null };

	beforeEach(() => {
		mocks.page.data.capabilities.ai = { usable: true, reason: 'available' };
	});

	/** Mounts with the widget closed and submits while the warm thread is pending. */
	async function submitFromClosedWidget(prompt: string) {
		const warmThread = Promise.withResolvers<WarmThread>();
		vi.mocked(client.mutation).mockImplementation((reference) =>
			getFunctionName(reference) === 'support/threads:getOrCreateWarmThread'
				? warmThread.promise
				: Promise.resolve({})
		);
		const support = mountSupport();
		await vi.waitFor(() => expect(support.conversation.userId).toBeTruthy());
		const input = document.querySelector('textarea')!;
		input.value = prompt;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
		await tick();
		const sends = () =>
			vi
				.mocked(client.mutation)
				.mock.calls.filter(
					([reference]) => getFunctionName(reference) === 'support/messages:sendMessage'
				)
				.map(([, args]) => args);
		return { support, input, warmThread, sends };
	}

	it('adopts its warm thread and sends once when nothing navigated', async () => {
		history = new BrowserHistory({ support: '', thread: '' });
		const { support, warmThread, sends } = await submitFromClosedWidget(
			'question for a new thread'
		);

		warmThread.resolve({ threadId: 'thread-a', notificationEmail: null });
		await vi.waitFor(() => expect(sends()).toHaveLength(1));
		await tick();

		expect(sends()[0]).toMatchObject({ threadId: 'thread-a', prompt: 'question for a new thread' });
		expect(support.conversation.threadId).toBe('thread-a');
		expect(history.current).toEqual({ support: 'open', thread: 'thread-a' });
		expect(sends()).toHaveLength(1);
	});

	it('yields to a history entry whose thread is still being validated', async () => {
		history = new BrowserHistory({ support: 'open', thread: 'thread-b' });
		history.write('support', '');
		history.write('thread', '');
		const threadRead = Promise.withResolvers<{ isHandedOff: boolean }>();
		vi.mocked(client.query).mockImplementation(async (reference, args) =>
			getFunctionName(reference) === 'support/threads:getThread' &&
			(args as { threadId: string }).threadId === 'thread-b'
				? threadRead.promise
				: {}
		);
		const { support, input, warmThread, sends } = await submitFromClosedWidget(
			'question awaiting warm thread'
		);

		// The history menu returns straight to the earlier entry naming thread B.
		history.index = 0;
		flushSync();
		await tick();
		warmThread.resolve({ threadId: 'thread-a', notificationEmail: null });
		await tick();
		await tick();
		await tick();
		expect(support.conversation.threadId).toBeNull();
		expect(sends()).toEqual([]);
		expect(history.current.thread).toBe('thread-b');
		expect(input.value).toBe('question awaiting warm thread');

		threadRead.resolve({ isHandedOff: false });
		await vi.waitFor(() => expect(support.conversation.threadId).toBe('thread-b'));
		expect(history.current).toEqual({ support: 'open', thread: 'thread-b' });
		expect(sends()).toEqual([]);
	});
});
