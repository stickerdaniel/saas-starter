/**
 * A chat surface that stays open through a session end, through the real
 * support widget and AI chat page over a fake Convex client that serves the
 * messages. The view of the ended session goes with it; the composer stays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount, type Component } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import type { ChatMessage, ChatMessagesArgs, MessageStatus } from '../core/types.js';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import AIChatPage from '../../../routes/[[lang]]/app/ai-chat/+page.svelte';
import CustomerSupport from '../../components/customer-support/customer-support.svelte';
import '../../components/customer-support/feedback-widget.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () => import('./test-fixtures/client-reactivity.ts'));
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const page = vi.hoisted(() => ({
	url: new URL('https://example.com/en'),
	params: { lang: 'en' },
	data: { lang: 'en' } as Record<string, unknown>
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test-build' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit', () => ({
	useCustomer: () => ({
		customer: {
			products: [],
			features: { ai_chat_messages: { balance: 5, included_usage: 10 } }
		},
		refetch: vi.fn()
	})
}));
vi.mock('#lib/components/billing/index.js', () => ({
	useBillingCheckout: () => ({ start: vi.fn(), isLoading: false })
}));
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
	useSupportUrlState: () => ({ support: 'open', thread: 'thread-a' })
}));
vi.mock('#lib/components/customer-support/threads-overview.svelte', () => ({ default: () => {} }));
vi.mock('#lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: true, lg: false, xl: false })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('#lib/components/SEOHead.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/message-quota-banner.svelte', () => ({ default: () => {} }));

function row(order: number, role: 'user' | 'assistant', text: string, status: MessageStatus) {
	return {
		id: `${role}-${order}-${text}`,
		key: `${role}-${order}-${text}`,
		_creationTime: order,
		order,
		stepOrder: role === 'user' ? 0 : 1,
		role,
		status,
		text,
		parts: text ? [{ type: 'text', text, state: 'done' }] : []
	} as ChatMessage;
}

const exchange = (question: string, answer: string, status: MessageStatus = 'success') => [
	row(0, 'user', question, 'success'),
	row(0, 'assistant', answer, status)
];

type Subscription = { name: string; args: ChatMessagesArgs; callback: (value: unknown) => void };

/**
 * A Convex client whose `deliver()` answers every message list subscription
 * from `threads`. Like the real client, it forgets a result once its last
 * subscriber is gone.
 */
function fakeConvex() {
	const threads = new Map<string, ChatMessage[]>();
	const results = new Map<string, unknown>();
	const subscriptions = new Set<Subscription>();
	const key = (name: string, args: unknown) => JSON.stringify([name, args]);
	const isList = ({ args }: Subscription) => args.streamArgs?.kind === 'list';
	const page = (messages: ChatMessage[]) => ({
		isDone: true,
		continueCursor: '',
		page: messages,
		streams: { kind: 'list', messages: [] }
	});
	const pending = () => new Promise<never>(() => {});
	const client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: (name: string, args: unknown) => results.get(key(name, args)) },
		onUpdate(
			query: FunctionReference<'query'>,
			args: ChatMessagesArgs,
			callback: (value: unknown) => void
		) {
			const subscription = { name: getFunctionName(query), args, callback };
			subscriptions.add(subscription);
			const unsubscribe = () => {
				subscriptions.delete(subscription);
				const id = key(subscription.name, args);
				if (![...subscriptions].some((other) => key(other.name, other.args) === id)) {
					results.delete(id);
				}
			};
			return Object.assign(unsubscribe, { unsubscribe, getCurrentValue: () => undefined });
		},
		query: vi.fn(async () => ({})),
		mutation: pending,
		action: pending
	};
	return {
		client: client as unknown as ConvexClient,
		threads,
		/** The message list subscriptions open now, to answer after they should be gone. */
		listSubscriptions: () => [...subscriptions].filter(isList),
		page,
		deliver() {
			flushSync();
			for (const subscription of [...subscriptions].filter(isList)) {
				const value = page(threads.get(subscription.args.threadId!) ?? []);
				results.set(key(subscription.name, subscription.args), value);
				subscription.callback(value);
			}
			flushSync();
		}
	};
}

let convex: ReturnType<typeof fakeConvex>;
let component: ReturnType<typeof mount> | undefined;
const originalElementAnimate = Element.prototype.animate;
const scrollTo = vi.fn();

const outsideChatbar = <E extends Element>(selector: string): E[] =>
	[...document.querySelectorAll<E>(selector)].filter((element) => !element.closest('.ai-chatbar'));
const shownText = () => outsideChatbar('[role="log"]')[0]?.textContent ?? '';

async function settle(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await tick();
}

async function enter(Page: Component<never>, path: string) {
	page.url = new URL(`https://example.com${path}?thread=thread-a`);
	page.data = {
		lang: 'en',
		viewer: { _id: 'user-1', name: 'Visitor' },
		capabilitiesResolved: true,
		capabilities: { billing: { usable: true }, ai: { usable: true } }
	};
	const contentProps = { data: page.data };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: {
			client: convex.client,
			content: Page as unknown as Component<typeof contentProps>,
			contentProps
		}
	});
	await settle();
	await vi.waitFor(() => expect(outsideChatbar('textarea')).toHaveLength(1));
	convex.deliver();
}

/** End the session, answer the old subscriptions with what that session saw next, and settle. */
async function endSessionWithLateResults(late: ChatMessage[]): Promise<void> {
	const held = convex.listSubscriptions();
	expect(held.length).toBeGreaterThan(0);
	clearPersistedChatState();
	await settle();
	for (const { callback } of held) callback(convex.page(late));
	await settle();
}

beforeEach(() => {
	localStorage.clear();
	convex = fakeConvex();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
	});
	Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: scrollTo });
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	clearPersistedChatState();
	document.body.replaceChildren();
	localStorage.clear();
	scrollTo.mockReset();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: originalElementAnimate
	});
});

/** Whether the "Talk to human" suggestion is on screen; a hidden one stays rendered, see-through. */
const handoffOffered = () => {
	const labels = [...document.querySelectorAll('span')].filter(
		(span) => span.textContent === en.chat.action.talk_to_human
	);
	expect(labels).toHaveLength(1);
	return labels[0]!.closest('div.transition-opacity')!.classList.contains('opacity-100');
};

describe('the open support widget at a session end', () => {
	it('shows nothing the ended session sees later, and the same thread as the next session reads it', async () => {
		convex.threads.set('thread-a', exchange('old question', 'old answer'));
		await enter(CustomerSupport, '/en');
		await vi.waitFor(() => expect(shownText()).toContain('old answer'));
		expect(handoffOffered()).toBe(true);

		await endSessionWithLateResults(exchange('old question', 'late old answer'));
		expect(shownText()).not.toContain('late old answer');

		convex.threads.set('thread-a', exchange('new question', '', 'pending'));
		convex.deliver();
		await settle();
		expect(shownText()).toContain('new question');
		expect(handoffOffered()).toBe(false);

		convex.threads.set('thread-a', exchange('new question', 'new answer'));
		convex.deliver();
		await settle();
		expect(shownText()).toContain('new answer');
		expect(shownText()).not.toContain('old');
		expect(handoffOffered()).toBe(true);
	});

	it('follows the next session to the bottom after the reader scrolled up in the ended one', async () => {
		convex.threads.set('thread-a', exchange('old question', 'old answer'));
		await enter(CustomerSupport, '/en');
		outsideChatbar('[role="log"]')[0]!.dispatchEvent(
			new WheelEvent('wheel', { deltaY: -120, bubbles: true })
		);
		scrollTo.mockClear();

		clearPersistedChatState();
		await settle();
		convex.threads.set('thread-a', exchange('new question', 'new answer'));
		convex.deliver();

		await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled());
		expect(scrollTo.mock.contexts.at(-1)).toBe(outsideChatbar('[role="log"]')[0]);
	});
});

describe('the open AI chat page at a session end', () => {
	it('closes an open attachment menu and shows nothing the ended session sees later', async () => {
		convex.threads.set('thread-a', exchange('old question', 'old answer'));
		await enter(AIChatPage, '/en/app/ai-chat');
		await vi.waitFor(() => expect(shownText()).toContain('old answer'));
		document
			.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.tooltip.more_actions}"]`)!
			.click();
		await settle();
		expect(document.querySelector('[role="menu"]')).not.toBeNull();

		await endSessionWithLateResults(exchange('old question', 'late old answer'));
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(shownText()).not.toContain('late old answer');

		convex.threads.set('thread-a', exchange('new question', 'new answer'));
		convex.deliver();
		await settle();
		expect(shownText()).toContain('new answer');
		expect(shownText()).not.toContain('old');
	});
});
