/**
 * The open support widget across a session end, through the real widget,
 * ChatRoot and ChatInput over a fake Convex client that serves the messages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import { clearPersistedChatState } from '#lib/chat/core/chat-persisted-state.ts';
import type { ChatMessage, ChatMessagesArgs, MessageStatus } from '#lib/chat/core/types.js';
import { ChatUIContext } from '#lib/chat/ui/chat-context.svelte.ts';
import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import FeedbackWidget from './feedback-widget.svelte';
import { SupportContext } from './support-context.svelte.ts';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () => import('#lib/chat/ui/test-fixtures/client-reactivity.ts'));
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('#lib/auth-client.js', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('#lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: false, lg: false, xl: false })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./threads-overview.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/index.js', async () => ({
	ChatRoot: (await import('#lib/chat/ui/ChatRoot.svelte')).default,
	ChatMessages: (await import('#lib/chat/ui/test-fixtures/DisplayedMessages.svelte')).default,
	ChatInput: (await import('#lib/chat/ui/ChatInput.svelte')).default
}));
vi.mock('#lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));

function row(
	threadId: string,
	order: number,
	role: 'user' | 'assistant',
	text: string,
	status: MessageStatus
): ChatMessage {
	return {
		id: `${threadId}-${order}-${role}`,
		key: `${threadId}-${order}-${role}`,
		_creationTime: order,
		order,
		stepOrder: role === 'user' ? 0 : 1,
		role,
		status,
		text,
		parts: status === 'success' || role === 'user' ? [{ type: 'text', text, state: 'done' }] : []
	} as ChatMessage;
}

/** A Convex client whose `deliver()` answers every message subscription from `threads`. */
function fakeConvex() {
	const threads = new Map<string, ChatMessage[]>();
	const results = new Map<string, unknown>();
	const subscriptions = new Set<{
		name: string;
		args: ChatMessagesArgs;
		callback: (value: unknown) => void;
	}>();
	const listMessages = getFunctionName(api.support.messages.listMessages);
	const key = (name: string, args: unknown) => JSON.stringify([name, args]);
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
			return Object.assign(() => subscriptions.delete(subscription), {
				unsubscribe: () => subscriptions.delete(subscription),
				getCurrentValue: () => undefined
			});
		},
		query: pending,
		mutation: pending,
		action: pending
	};
	function deliver(): void {
		flushSync();
		for (const { name, args, callback } of subscriptions) {
			if (name !== listMessages || args.streamArgs?.kind !== 'list') continue;
			const value = {
				isDone: true,
				continueCursor: '',
				page: threads.get(args.threadId!) ?? [],
				streams: { kind: 'list', messages: [] }
			};
			results.set(key(name, args), value);
			callback(value);
		}
		flushSync();
	}
	return { client: client as unknown as ConvexClient, threads, deliver };
}

const shownMessages = () =>
	[...document.querySelectorAll('[data-testid="displayed-messages"] li')].map(
		(item) => item.textContent
	);

/** Whether the "Talk to human" suggestion is on screen; a hidden one stays rendered, see-through and inert. */
const handoffOffered = () => {
	const labels = [...document.querySelectorAll('span')].filter(
		(span) => span.textContent === en.chat.action.talk_to_human
	);
	expect(labels).toHaveLength(1);
	const wrapper = labels[0]!.closest<HTMLElement>('div.transition-opacity')!;
	return !wrapper.inert && wrapper.classList.contains('opacity-100');
};

let component: ReturnType<typeof mount> | undefined;
let context: ChatUIContext | undefined;
const originalElementAnimate = Element.prototype.animate;

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	context?.dispose();
	context = undefined;
	clearPersistedChatState();
	document.body.replaceChildren();
	localStorage.clear();
	vi.restoreAllMocks();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: originalElementAnimate
	});
});

describe('the open support widget at a session end', () => {
	it('stops showing the ended session at once and offers the handoff only after the next reply completes', async () => {
		const convex = fakeConvex();
		convex.threads.set('thread-a', [
			row('thread-a', 0, 'user', 'old question', 'success'),
			row('thread-a', 0, 'assistant', 'old answer', 'success')
		]);
		const support = new SupportContext(() => true);
		support.selectThread('thread-a');
		context = new ChatUIContext(support.conversation, convex.client, support.composer);
		component = mount(ChatTestProvider<{ chatUIContext: ChatUIContext }>, {
			target: document.body,
			props: {
				client: convex.client,
				content: FeedbackWidget,
				contentProps: { chatUIContext: context },
				supportThread: support
			}
		});
		await tick();
		convex.deliver();
		expect(shownMessages()).toEqual(['old question', 'old answer']);
		expect(handoffOffered()).toBe(true);

		clearPersistedChatState();
		flushSync();
		expect(shownMessages()).toEqual([]);
		await tick();
		expect(shownMessages()).toEqual([]);

		convex.threads.set('thread-b', [
			row('thread-b', 0, 'user', 'new question', 'success'),
			row('thread-b', 0, 'assistant', '', 'pending')
		]);
		support.selectThread('thread-b');
		convex.deliver();
		expect(shownMessages()).toEqual(['new question', '']);
		expect(handoffOffered()).toBe(false);

		convex.threads.set('thread-b', [
			row('thread-b', 0, 'user', 'new question', 'success'),
			row('thread-b', 0, 'assistant', 'new answer', 'success')
		]);
		convex.deliver();
		expect(shownMessages()).toEqual(['new question', 'new answer']);
		expect(handoffOffered()).toBe(true);
	});
});
