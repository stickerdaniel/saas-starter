/**
 * Send settlement on the template's own chat surfaces, driven through their
 * real composer: type, press send, let the transport answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import AIThreadChat from '../../../routes/[[lang]]/app/ai-chat/thread-chat.svelte';
import FeedbackWidget from '../../components/customer-support/feedback-widget.svelte';
import { SupportContext } from '../../components/customer-support/support-context.svelte.ts';
import { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import { ChatUIContext } from './chat-context.svelte.ts';
import { ChatComposer } from './chat-composer.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ThreadChatConsumerHarness, {
	threadChatConsumerHarness
} from './test-fixtures/ThreadChatConsumerHarness.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('svelte/reactivity', () => import('./test-fixtures/client-reactivity.ts'));
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/chat/index.js', async () => ({
	ChatRoot: (await import('./ChatRoot.svelte')).default,
	ChatMessages: () => {},
	ChatInput: (await import('./ChatInput.svelte')).default
}));
vi.mock('#lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('#lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/message-quota-banner.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('#lib/auth-client.js', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('#lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: false, lg: false, xl: false })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('#lib/components/customer-support/threads-overview.svelte', () => ({ default: () => {} }));

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
const originalElementAnimate = Element.prototype.animate;

function storedDrafts(surface: 'ai-chat' | 'admin-support'): Record<string, string> {
	return JSON.parse(localStorage.getItem(`drafts:${surface}`) ?? '{}');
}

const textarea = () => document.querySelector('textarea')!;
const sendButton = () =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!;

async function type(value: string): Promise<void> {
	textarea().value = value;
	textarea().dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

async function send(value: string): Promise<void> {
	await type(value);
	expect(sendButton().disabled).toBe(false);
	sendButton().click();
	await tick();
}

async function settleWork(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await tick();
}

async function unmountComponent(): Promise<void> {
	if (component) await unmount(component);
	component = undefined;
}

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }))
	});
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
	delete threadChatConsumerHarness.setThreadId;
});

afterEach(async () => {
	try {
		await unmountComponent();
		await client.close();
		localStorage.clear();
		vi.restoreAllMocks();
	} finally {
		Object.defineProperty(Element.prototype, 'animate', {
			configurable: true,
			value: originalElementAnimate
		});
	}
});

describe('AI chat across a remount', () => {
	const pageOwner = () => new ChatComposer({ surface: 'ai-chat', storeFiles: true });

	async function mountChat(composer: ChatComposer): Promise<void> {
		const contentProps = { threadId: 'thread-a', hasMessagesAvailable: true, composer };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: AIThreadChat, contentProps }
		});
		await tick();
	}

	it('keeps an identical prompt typed again and stored before the remount', async () => {
		const reply = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const composer = pageOwner();
		await mountChat(composer);
		await send('same');
		await type('same');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'same' });

		await unmountComponent();
		await mountChat(composer);
		expect(textarea().value).toBe('same');
		reply.reject(new Error('refused'));
		await settleWork();

		expect(textarea().value).toBe('same\n\nsame');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'same\n\nsame' });
	});

	it('does not repeat the stored copy of the pending send after a remount', async () => {
		const reply = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const composer = pageOwner();
		await mountChat(composer);
		await send('same');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'same' });

		await unmountComponent();
		await mountChat(composer);
		expect(textarea().value).toBe('');
		reply.reject(new Error('refused'));
		await settleWork();

		expect(textarea().value).toBe('same');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'same' });
	});

	it('keeps a draft another tab stored before the send when the send is accepted', async () => {
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const composer = pageOwner();
		await mountChat(composer);
		await type('send this');
		const stored = JSON.stringify({ 'thread-a': 'typed in another tab' });
		localStorage.setItem('drafts:ai-chat', stored);
		window.dispatchEvent(new StorageEvent('storage', { key: 'drafts:ai-chat', newValue: stored }));
		await tick();
		expect(textarea().value).toBe('send this');
		sendButton().click();
		await tick();

		await unmountComponent();
		await mountChat(composer);
		expect(textarea().value).toBe('typed in another tab');
		reply.resolve({});
		await settleWork();

		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'typed in another tab' });
		expect(textarea().value).toBe('typed in another tab');
	});

	it('keeps a draft with the same text typed after the remount when the send is accepted', async () => {
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const composer = pageOwner();
		await mountChat(composer);
		await send('same');

		await unmountComponent();
		await mountChat(composer);
		await type('same');
		reply.resolve({});
		await settleWork();

		expect(textarea().value).toBe('same');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'same' });
	});
});

describe('admin support across keyed thread switches', () => {
	it('restores into a remounted origin with newer text and leaves the other thread alone', async () => {
		const reply = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const contentProps = { kind: 'admin' as const, initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ThreadChatConsumerHarness, contentProps }
		});
		await tick();
		const switchTo = async (threadId: string) => {
			flushSync(() => threadChatConsumerHarness.setThreadId?.(threadId));
			await tick();
		};

		await send('from A');
		await switchTo('thread-b');
		await switchTo('thread-a');
		expect(textarea().value).toBe('');
		await type('newer A');
		await switchTo('thread-b');
		await type('typed in B');

		reply.reject(new Error('refused'));
		await settleWork();
		expect(textarea().value).toBe('typed in B');
		expect(storedDrafts('admin-support')['thread-b']).toBe('typed in B');

		await switchTo('thread-a');
		expect(textarea().value).toBe('from A\n\nnewer A');
	});
});

describe.each([
	{ kind: 'ai' as const, surface: 'ai-chat' as const },
	{ kind: 'admin' as const, surface: 'admin-support' as const }
])('$kind accepted send', ({ kind, surface }) => {
	async function mountHarness() {
		const contentProps = { kind, initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ThreadChatConsumerHarness, contentProps }
		});
		await tick();
	}

	it('clears only the unchanged origin draft after switching threads', async () => {
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		await mountHarness();
		await send('send from A');
		flushSync(() => threadChatConsumerHarness.setThreadId?.('thread-b'));
		await tick();
		await type('keep in B');

		reply.resolve({});
		await settleWork();

		expect(storedDrafts(surface)).toEqual({ 'thread-b': 'keep in B' });
	});

	it.each(['a newer draft', 'send this'])(
		'preserves later same-thread text %s after success',
		async (later) => {
			const reply = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
			await mountHarness();
			await send('send this');
			await type(later);

			reply.resolve({});
			await settleWork();

			expect(storedDrafts(surface)).toEqual({ 'thread-a': later });
			expect(textarea().value).toBe(later);
		}
	);

	it('keeps a draft with the same text typed after leaving the thread and coming back', async () => {
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		await mountHarness();
		await send('send this');
		flushSync(() => threadChatConsumerHarness.setThreadId?.('thread-b'));
		await tick();
		flushSync(() => threadChatConsumerHarness.setThreadId?.('thread-a'));
		await tick();
		expect(textarea().value).toBe('');
		await type('send this');

		reply.resolve({});
		await settleWork();

		expect(storedDrafts(surface)).toEqual({ 'thread-a': 'send this' });
		expect(textarea().value).toBe('send this');
	});

	it('clears the stored draft of a sent text with surrounding whitespace', async () => {
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		await mountHarness();
		await send('  send this \n');
		expect(storedDrafts(surface)).toEqual({ 'thread-a': '  send this \n' });

		reply.resolve({});
		await settleWork();

		expect(storedDrafts(surface)).toEqual({});
		expect(textarea().value).toBe('');
	});
});

describe('AI thread switches', () => {
	async function mountHarness() {
		const contentProps = { kind: 'ai' as const, initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ThreadChatConsumerHarness, contentProps }
		});
		await tick();
	}

	it('stores a refusal for the origin and leaves the visible thread unchanged', async () => {
		const reply = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		await mountHarness();
		await send('retry in A');
		threadChatConsumerHarness.setThreadId?.('thread-b');
		await tick();

		reply.reject(new Error('refused'));
		await settleWork();

		expect(textarea().value).toBe('');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'retry in A' });
	});

	it.each(['success', 'rejection'] as const)(
		'keeps a cleared B draft deleted after stale A %s',
		async (outcome) => {
			const reply = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
			await mountHarness();
			await send('send from A');
			threadChatConsumerHarness.setThreadId?.('thread-b');
			await tick();
			await type('draft in B');
			expect(storedDrafts('ai-chat')['thread-b']).toBe('draft in B');
			await type('');
			expect(storedDrafts('ai-chat')).not.toHaveProperty('thread-b');

			if (outcome === 'success') reply.resolve({});
			else reply.reject(new Error('thread A provider detail'));
			await settleWork();

			expect(storedDrafts('ai-chat')).not.toHaveProperty('thread-b');
		}
	);

	it('does not let a stale A completion release the copy a pending B send holds', async () => {
		const replyA = Promise.withResolvers<Record<string, never>>();
		const replyB = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation')
			.mockReturnValueOnce(replyA.promise)
			.mockReturnValueOnce(replyB.promise);
		await mountHarness();
		await send('send from A');
		threadChatConsumerHarness.setThreadId?.('thread-b');
		await tick();
		await send('send from B');

		replyA.resolve({});
		await settleWork();
		expect(storedDrafts('ai-chat')['thread-b']).toBe('send from B');

		replyB.resolve({});
		await settleWork();
		expect(storedDrafts('ai-chat')).not.toHaveProperty('thread-b');
	});
});

describe('support widget accepted send', () => {
	it('preserves a later support draft after success', async () => {
		const support = new SupportContext();
		const { conversation } = support;
		const drafts = new ChatDraftManager('support');
		support.selectThread('thread-support');
		drafts.setDraft('thread-support', 'send this');
		const context = new ChatUIContext(conversation, client, support.composer);
		context.setDisplayMessages([]);
		const reply = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(reply.promise);
		const contentProps = { chatUIContext: context };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: FeedbackWidget, contentProps, supportThread: support }
		});
		await tick();
		expect(textarea().value).toBe('send this');

		sendButton().click();
		await tick();
		await type('keep this');
		drafts.setDraft('thread-support', 'keep this');
		reply.resolve({});
		await settleWork();

		expect(drafts.getDraft('thread-support')).toBe('keep this');
		await unmountComponent();
		context.dispose();
	});

	it.each([
		{ since: 'nothing typed since', later: '', stored: {} },
		{
			since: 'the same text typed since',
			later: 'send this',
			stored: { 'support-created': 'send this' }
		}
	])(
		'keeps only a later draft under the id its send created, with $since',
		async ({ later, stored }) => {
			const support = new SupportContext();
			const { conversation } = support;
			support.startNewThread();
			const context = new ChatUIContext(conversation, client, support.composer);
			context.setDisplayMessages([]);
			const creation = Promise.withResolvers<{ threadId: string; notificationEmail: null }>();
			const reply = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				const name = getFunctionName(reference);
				if (name === 'support/threads:getOrCreateWarmThread') return creation.promise;
				if (name === 'support/messages:sendMessage') return reply.promise;
				return Promise.resolve({});
			});
			const contentProps = { chatUIContext: context };
			component = mount(ChatTestProvider<typeof contentProps>, {
				target: document.body,
				props: { client, content: FeedbackWidget, contentProps, supportThread: support }
			});
			await tick();
			await send('send this');
			if (later) await type(later);

			creation.resolve({ threadId: 'support-created', notificationEmail: null });
			await vi.waitFor(() => expect(conversation.threadId).toBe('support-created'));
			reply.resolve({});
			await settleWork();

			expect(JSON.parse(localStorage.getItem('drafts:support') ?? '{}')).toEqual(stored);
			expect(textarea().value).toBe(later);
			await unmountComponent();
			context.dispose();
		}
	);
});
