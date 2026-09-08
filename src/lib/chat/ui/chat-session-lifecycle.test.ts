import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { api } from '$lib/convex/_generated/api';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import { CHAT_PAGE_SIZE, type Attachment } from '../core/types.js';
import type { ChatCore } from '../core/chat-core.svelte.ts';
import { ChatUIContext } from './chat-context.svelte.ts';
import { SupportThreadContext } from '$lib/components/customer-support/support-thread-context.svelte.ts';
import FeedbackWidget from '$lib/components/customer-support/feedback-widget.svelte';
import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
import { toast } from 'svelte-sonner';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import KeyedAdminThreadLifecycleHarness, {
	keyedAdminThreadLifecycle
} from './test-fixtures/KeyedAdminThreadLifecycleHarness.svelte';
import { capturedAttachments } from './test-fixtures/CapturedChatAttachments.svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('$lib/auth-client', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
vi.mock('$lib/hooks/use-media.svelte.ts', () => ({
	useMedia: () => ({ sm: false, lg: false, xl: false })
}));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('$lib/components/customer-support/threads-overview.svelte', () => ({ default: () => {} }));
vi.mock('$lib/chat', async () => ({
	ChatRoot: (await import('./ChatRoot.svelte')).default,
	ChatMessages: () => {},
	ChatInput: (await import('./ChatInput.svelte')).default
}));
vi.mock('$lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('$lib/chat/ui/ChatAttachments.svelte', async () => ({
	default: (await import('./test-fixtures/CapturedChatAttachments.svelte')).default
}));

const oldAttachment: Attachment = {
	type: 'file',
	key: 'old-file',
	name: 'old.txt',
	size: 12,
	mimeType: 'text/plain',
	url: 'https://chat.test/old.txt',
	uploadState: { status: 'success', progress: 100, fileId: 'old-file-id' }
};

const generationTwoAttachment: Attachment = {
	type: 'file',
	key: 'generation-two-file',
	name: 'generation-two.txt',
	size: 18,
	mimeType: 'text/plain',
	url: 'https://chat.test/generation-two.txt',
	uploadState: { status: 'success', progress: 100, fileId: 'generation-two-file-id' }
};

const sharedFileAttachment: Attachment = {
	type: 'file',
	key: 'shared-file-second-key',
	name: 'shared-copy.txt',
	size: 24,
	mimeType: 'text/plain',
	url: 'https://chat.test/shared-copy.txt',
	uploadState: { status: 'success', progress: 100, fileId: 'old-file-id' }
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
const contexts: ChatUIContext[] = [];
const originalElementAnimate = Element.prototype.animate;

function storedAttachment(attachment: Extract<Attachment, { type: 'file' | 'screenshot' }>) {
	return {
		id: attachment.key,
		type: attachment.type,
		name: attachment.name,
		size: attachment.size,
		mimeType: attachment.mimeType,
		url: attachment.url,
		fileId: attachment.uploadState?.fileId,
		savedAt: Date.now()
	};
}

function typeInto(input: HTMLTextAreaElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function sendButton(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!;
}

function sendLoader(): SVGElement | null {
	const loaderClass = ['motion-safe', ['animate', 'spin'].join('-')].join(':');
	return (
		[...sendButton().querySelectorAll('svg')].find((icon) =>
			icon.classList.contains(loaderClass)
		) ?? null
	);
}

async function settleComponentWork(): Promise<void> {
	await Promise.resolve();
	await tick();
	await Promise.resolve();
}

function mockUnsubscribe() {
	const unsubscribe = vi.fn();
	return Object.assign(unsubscribe, {
		unsubscribe,
		getCurrentValue: vi.fn()
	});
}

async function mountSupport(thread: SupportThreadContext, context: ChatUIContext): Promise<void> {
	contexts.push(context);
	context.setDisplayMessages([]);
	const contentProps = { chatUIContext: context };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: {
			client,
			content: FeedbackWidget,
			contentProps,
			supportThread: thread
		}
	});
	await tick();
}

async function mountChatbar(thread: SupportThreadContext): Promise<HTMLTextAreaElement> {
	const contentProps = { isFeedbackOpen: false };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: AIChatbar, contentProps, supportThread: thread }
	});
	await tick();
	return document.querySelector('textarea')!;
}

const navigationBoundaries = [
	{
		name: 'goBack',
		navigate: (thread: SupportThreadContext) => thread.goBack(),
		selectedThreadId: null,
		view: 'overview' as const
	},
	{
		name: 'selectThread',
		navigate: (thread: SupportThreadContext) => thread.selectThread('thread-b'),
		selectedThreadId: 'thread-b',
		view: 'chat' as const
	},
	{
		name: 'selectThreadFromUrl',
		navigate: (thread: SupportThreadContext) => thread.selectThreadFromUrl('thread-b'),
		selectedThreadId: 'thread-b',
		view: 'chat' as const
	}
];

beforeEach(() => {
	localStorage.clear();
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({
			cancel: vi.fn(),
			currentTime: 0,
			effect: null,
			onfinish: null,
			playState: 'finished'
		}))
	});
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	delete keyedAdminThreadLifecycle.setThreadId;
	delete capturedAttachments.props;
	vi.mocked(toast.error).mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	try {
		if (component) await unmount(component);
		component = undefined;
		for (const context of contexts.splice(0)) context.dispose();
		await client.close();
		localStorage.clear();
		vi.restoreAllMocks();
	} finally {
		Object.defineProperty(Element.prototype, 'animate', {
			configurable: true,
			value: originalElementAnimate
		});
		vi.useRealTimers();
	}
});

describe('chat session lifecycle', () => {
	it('session clear prevents a rejected real admin send from restoring prior-session composer state', async () => {
		const threadId = 'session-thread';
		localStorage.setItem(
			'drafts:admin-support',
			JSON.stringify({ [threadId]: 'old session text' })
		);
		localStorage.setItem(
			'attachments:admin-support',
			JSON.stringify({ [threadId]: [storedAttachment(oldAttachment)] })
		);
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			if (getFunctionName(reference) === 'admin/support/mutations:sendAdminReply') {
				return pending.promise;
			}
			return Promise.resolve({});
		});
		const contentProps = { initialThreadId: threadId };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: KeyedAdminThreadLifecycleHarness, contentProps }
		});
		await tick();
		const input = document.querySelector('textarea')!;
		await vi.waitFor(() => expect(input.value).toBe('old session text'));
		expect(capturedAttachments.props?.attachments?.[0]).toEqual(
			expect.objectContaining({ name: 'old.txt' })
		);

		sendButton().click();
		await vi.waitFor(() => expect(mutation).toHaveBeenCalled());
		clearPersistedChatState();
		expect(input.value).toBe('');

		pending.reject(new Error('Send rejected'));
		await tick();

		expect(console.error).not.toHaveBeenCalled();
		expect(input.value).toBe('');
		expect(JSON.parse(localStorage.getItem('drafts:admin-support') ?? '{}')).toEqual({});
		expect(JSON.parse(localStorage.getItem('attachments:admin-support') ?? '{}')).toEqual({});
	});

	it('a generation-one null-origin rejection cannot contaminate generation two', async () => {
		const thread = new SupportThreadContext();
		thread.startNewThread();
		const context = new ChatUIContext(thread as unknown as ChatCore, client, {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore('support')
		});
		const message = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				return Promise.resolve({ threadId: 'generation-one-thread', notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return message.promise;
			return Promise.resolve({});
		});
		await mountSupport(thread, context);
		const input = document.querySelector('textarea')!;
		typeInto(input, 'generation one text');
		context.addAttachments([oldAttachment]);
		await tick();
		sendButton().click();
		await vi.waitFor(() => expect(thread.threadId).toBe('generation-one-thread'));

		thread.goBack();
		thread.startNewThread();
		context.setDisplayMessages([]);
		await tick();
		typeInto(input, 'generation two text');
		context.addAttachments([generationTwoAttachment]);
		await tick();
		message.reject(new Error('Generation one rejected'));
		await vi.waitFor(() => expect(console.error).toHaveBeenCalled());

		expect(input.value).toBe('generation two text');
		expect(
			context.attachments.map((attachment) => ('key' in attachment ? attachment.key : ''))
		).toEqual(['generation-two-file']);
		expect(
			new ChatAttachmentStore('support')
				.readThread(null)
				.map((attachment) => ('key' in attachment ? attachment.key : ''))
		).toEqual(['generation-two-file']);
		expect(
			new ChatAttachmentStore('support')
				.readThread('generation-one-thread')
				.map((attachment) => ('key' in attachment ? attachment.key : ''))
		).toEqual(['old-file']);
	});

	it('keyed admin A to B to A preserves a rejected A snapshot in the new A instance', async () => {
		localStorage.setItem(
			'attachments:admin-support',
			JSON.stringify({ 'thread-a': [storedAttachment(oldAttachment)] })
		);
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockImplementation((reference) =>
			getFunctionName(reference) === 'admin/support/mutations:sendAdminReply'
				? pending.promise
				: Promise.resolve({})
		);
		const contentProps = { initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: KeyedAdminThreadLifecycleHarness, contentProps }
		});
		await tick();
		const input = document.querySelector('textarea')!;
		typeInto(input, 'reply from A');
		await tick();
		sendButton().click();
		await tick();

		flushSync(() => keyedAdminThreadLifecycle.setThreadId?.('thread-b'));
		await tick();
		flushSync(() => keyedAdminThreadLifecycle.setThreadId?.('thread-a'));
		await tick();
		expect(capturedAttachments.props?.attachments?.[0]).toBeUndefined();

		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(console.error).toHaveBeenCalled());

		expect(capturedAttachments.props?.attachments?.[0]).toEqual(
			expect.objectContaining({ name: 'old.txt' })
		);
	});

	it.each(['success', 'rejection'] as const)(
		'lazy support assignment preserves later typing after $0',
		async (outcome) => {
			const thread = new SupportThreadContext();
			thread.startNewThread();
			const context = new ChatUIContext(thread as unknown as ChatCore, client, {
				generateUploadUrl: api.support.files.generateUploadUrl,
				saveUploadedFile: api.support.files.saveUploadedFile,
				attachmentStore: new ChatAttachmentStore('support')
			});
			const creation = Promise.withResolvers<{
				threadId: string;
				notificationEmail: null;
			}>();
			const message = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				const name = getFunctionName(reference);
				if (name === 'support/threads:getOrCreateWarmThread') return creation.promise;
				if (name === 'support/messages:sendMessage') return message.promise;
				return Promise.resolve({});
			});
			await mountSupport(thread, context);
			const input = document.querySelector('textarea')!;
			typeInto(input, 'send this');
			await tick();
			sendButton().click();
			await tick();
			typeInto(input, 'later support draft');
			await tick();

			creation.resolve({ threadId: `support-created-${outcome}`, notificationEmail: null });
			await vi.waitFor(() => expect(thread.threadId).toBe(`support-created-${outcome}`));
			if (outcome === 'success') message.resolve({});
			else message.reject(new Error('Send rejected'));
			await vi.waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
			await tick();

			expect(input.value).toBe('later support draft');
			expect(context.inputValue).toBe('later support draft');
			expect(thread.getDraft(`support-created-${outcome}`)).toBe('later support draft');
		}
	);

	it('loads support drafts on mount and navigation and resets a new generation', async () => {
		const thread = new SupportThreadContext();
		thread.setDraft('thread-a', 'draft A');
		thread.setDraft('thread-b', 'draft B');
		thread.setThread('thread-a');
		thread.currentView = 'chat';
		const context = new ChatUIContext(thread as unknown as ChatCore, client);
		await mountSupport(thread, context);
		const input = document.querySelector('textarea')!;
		await vi.waitFor(() => expect(input.value).toBe('draft A'));

		thread.selectThread('thread-b');
		await vi.waitFor(() => expect(input.value).toBe('draft B'));
		thread.startNewThread();
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('session clear resets support send state synchronously', () => {
		const thread = new SupportThreadContext();
		const context = new ChatUIContext(thread as unknown as ChatCore, client);
		contexts.push(context);
		thread.isSending = true;
		thread.isAwaitingStream = true;
		thread.error = 'old error';
		thread.shouldOpenWidget = true;
		thread.setRateLimited(60_000);

		clearPersistedChatState();

		expect(thread.isSending).toBe(false);
		expect(thread.isAwaitingStream).toBe(false);
		expect(thread.error).toBeNull();
		expect(thread.shouldOpenWidget).toBe(false);
		expect(thread.rateLimitedUntil).toBeNull();
	});

	it('does not retry a rejected eager send into a thread selected after going back', async () => {
		const thread = new SupportThreadContext();
		const context = new ChatUIContext(thread as unknown as ChatCore, client, {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore('support')
		});
		const creation = Promise.withResolvers<{
			threadId: string;
			notificationEmail: null;
		}>();
		const creationError = new Error('Original eager creation rejected');
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') return creation.promise;
			if (name === 'support/messages:sendMessage') return Promise.resolve({});
			return Promise.resolve({});
		});
		thread.setClient(client);
		thread.startNewThread();
		await mountSupport(thread, context);
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
		context.addAttachments([oldAttachment, sharedFileAttachment]);

		const result = thread.sendMessage(client, ' old prompt ', {
			fileIds: context.uploadedFileIds,
			attachments: [...context.attachments]
		});
		expect(thread.isSending).toBe(true);
		thread.goBack();
		thread.selectThread('thread-b');
		expect(thread.isSending).toBe(false);

		creation.reject(creationError);
		await expect(result).rejects.toBe(creationError);
		await tick();

		expect(thread.isSending).toBe(false);
		expect(thread.threadId).toBe('thread-b');
		expect(context.captureSendSnapshot().origin).toEqual({
			generation: thread.threadGeneration,
			threadId: 'thread-b'
		});
		expect(context.displayMessages).toEqual([]);
		expect(mutation).toHaveBeenCalledTimes(1);
		const [reference, args] = mutation.mock.calls[0]!;
		expect(getFunctionName(reference)).toBe('support/threads:getOrCreateWarmThread');
		expect(args).toEqual({
			anonymousUserId: undefined,
			pageUrl: window.location.href
		});
	});

	it.each(
		navigationBoundaries.flatMap((boundary) =>
			(['fulfilled', 'rejected'] as const).map((outcome) => ({ ...boundary, outcome }))
		)
	)(
		'a $outcome eager creation after $name neither binds nor dispatches',
		async ({ navigate, selectedThreadId, view, outcome }) => {
			const thread = new SupportThreadContext();
			const context = new ChatUIContext(thread as unknown as ChatCore, client);
			const creation = Promise.withResolvers<{
				threadId: string;
				notificationEmail: null;
			}>();
			const creationError = new Error('Retained creation error');
			const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				if (getFunctionName(reference) === 'support/threads:getOrCreateWarmThread') {
					return creation.promise;
				}
				throw new Error('A stale send must not dispatch');
			});
			thread.setClient(client);
			thread.startNewThread();
			await mountSupport(thread, context);
			const result = thread.sendMessage(client, 'stale prompt');
			await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

			navigate(thread);
			if (outcome === 'fulfilled') {
				creation.resolve({ threadId: 'stale-created-thread', notificationEmail: null });
				await expect(result).rejects.toThrow('Support conversation changed');
			} else {
				creation.reject(creationError);
				await expect(result).rejects.toBe(creationError);
			}

			expect(mutation).toHaveBeenCalledTimes(1);
			expect(thread.threadId).toBe(selectedThreadId);
			expect(context.captureSendSnapshot().origin).toEqual({
				generation: thread.threadGeneration,
				threadId: selectedThreadId
			});
			expect(thread.currentView).toBe(view);
			expect(thread.isSending).toBe(false);
		}
	);

	it('uses a same-navigation eager creation with exact attachment order and optimistic payload', async () => {
		const thread = new SupportThreadContext();
		const context = new ChatUIContext(thread as unknown as ChatCore, client, {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore('support')
		});
		contexts.push(context);
		const creation = Promise.withResolvers<{
			threadId: string;
			notificationEmail: null;
		}>();
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			if (getFunctionName(reference) === 'support/threads:getOrCreateWarmThread') {
				return creation.promise;
			}
			return Promise.resolve({});
		});
		thread.setClient(client);
		thread.startNewThread();
		context.addAttachments([oldAttachment, sharedFileAttachment, generationTwoAttachment]);
		const attachments = [...context.attachments];
		const result = thread.sendMessage(client, ' ordered prompt ', {
			fileIds: context.uploadedFileIds,
			attachments
		});

		creation.resolve({ threadId: 'same-navigation-thread', notificationEmail: null });
		await expect(result).resolves.toEqual({
			threadId: 'same-navigation-thread',
			threadCreated: false
		});
		expect(context.captureSendSnapshot().origin).toEqual({
			generation: thread.threadGeneration,
			threadId: 'same-navigation-thread'
		});
		expect(mutation).toHaveBeenCalledTimes(2);
		const [warmReference, warmArgs] = mutation.mock.calls[0]!;
		expect(getFunctionName(warmReference)).toBe('support/threads:getOrCreateWarmThread');
		expect(warmArgs).toEqual({
			anonymousUserId: undefined,
			pageUrl: window.location.href
		});
		const [messageReference, messageArgs, options] = mutation.mock.calls[1]!;
		expect(getFunctionName(messageReference)).toBe('support/messages:sendMessage');
		expect(messageArgs).toEqual({
			threadId: 'same-navigation-thread',
			prompt: 'ordered prompt',
			anonymousUserId: undefined,
			fileIds: ['old-file-id', 'old-file-id', 'generation-two-file-id']
		});

		const current = { page: [], isDone: true, continueCursor: '' };
		const store = {
			getQuery: vi.fn().mockReturnValue(current),
			setQuery: vi.fn()
		};
		expect(options?.optimisticUpdate).toBeTypeOf('function');
		(options!.optimisticUpdate as (store: unknown) => void)(store);
		expect(store.getQuery).toHaveBeenCalledWith(expect.anything(), {
			threadId: 'same-navigation-thread',
			paginationOpts: { numItems: CHAT_PAGE_SIZE, cursor: null },
			streamArgs: { kind: 'list', startOrder: 0 }
		});
		expect(getFunctionName(store.getQuery.mock.calls[0]![0])).toBe('support/messages:listMessages');
		expect(store.setQuery).toHaveBeenCalledTimes(1);
		const [listReference, listArgs, optimisticResult] = store.setQuery.mock.calls[0]!;
		expect(getFunctionName(listReference)).toBe('support/messages:listMessages');
		expect(listArgs).toEqual(store.getQuery.mock.calls[0]![1]);
		expect(optimisticResult).toEqual({
			...current,
			page: [
				expect.objectContaining({
					threadId: 'same-navigation-thread',
					role: 'user',
					message: { role: 'user', content: 'ordered prompt' },
					text: 'ordered prompt',
					status: 'success',
					order: 0,
					metadata: { optimistic: true },
					localAttachments: attachments
				})
			]
		});
	});

	it('retries a rejected eager creation when the conversation has not navigated', async () => {
		const thread = new SupportThreadContext();
		const firstCreation = Promise.withResolvers<{
			threadId: string;
			notificationEmail: null;
		}>();
		let warmCalls = 0;
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				warmCalls++;
				return warmCalls === 1
					? firstCreation.promise
					: Promise.resolve({ threadId: 'retry-thread', notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return Promise.resolve({});
			return Promise.resolve({});
		});
		thread.setClient(client);
		thread.startNewThread();
		const result = thread.sendMessage(client, 'retry prompt');
		const firstError = new Error('First eager creation rejected');
		firstCreation.reject(firstError);

		await expect(result).resolves.toEqual({ threadId: 'retry-thread', threadCreated: true });
		expect(mutation.mock.calls.map(([reference]) => getFunctionName(reference))).toEqual([
			'support/threads:getOrCreateWarmThread',
			'support/threads:getOrCreateWarmThread',
			'support/messages:sendMessage'
		]);
		expect(thread.threadId).toBe('retry-thread');
		expect(thread.isSending).toBe(false);
	});

	it.each([
		{ boundary: 'generation' as const, outcome: 'success' as const },
		{ boundary: 'generation' as const, outcome: 'rejection' as const },
		{ boundary: 'session' as const, outcome: 'success' as const },
		{ boundary: 'session' as const, outcome: 'rejection' as const }
	])(
		'an old creation $outcome after a $boundary change performs no new mutation',
		async ({ boundary, outcome }) => {
			const thread = new SupportThreadContext();
			thread.startNewThread();
			const context = new ChatUIContext(thread as unknown as ChatCore, client);
			contexts.push(context);
			const creation = Promise.withResolvers<{
				threadId: string;
				notificationEmail: null;
			}>();
			const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				if (getFunctionName(reference) === 'support/threads:getOrCreateWarmThread') {
					return creation.promise;
				}
				throw new Error('The old send must not submit a message');
			});
			const result = thread.sendMessage(client, 'old prompt');
			await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

			if (boundary === 'generation') thread.startNewThread();
			else clearPersistedChatState();

			if (outcome === 'success') {
				creation.resolve({ threadId: 'old-thread', notificationEmail: null });
				await expect(result).rejects.toThrow('Support conversation changed');
			} else {
				const error = new Error('Creation rejected');
				creation.reject(error);
				await expect(result).rejects.toBe(error);
			}
			expect(mutation).toHaveBeenCalledTimes(1);
			expect(thread.threadId).toBeNull();
			expect(thread.isSending).toBe(false);
		}
	);

	it('does not roll a successful dispatched send back into a later selected thread', async () => {
		const thread = new SupportThreadContext();
		thread.selectThread('thread-a');
		const context = new ChatUIContext(thread as unknown as ChatCore, client, {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore('support')
		});
		const message = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			if (getFunctionName(reference) === 'support/messages:sendMessage') return message.promise;
			return Promise.resolve({});
		});
		await mountSupport(thread, context);
		const input = document.querySelector('textarea')!;
		typeInto(input, 'send from A');
		context.addAttachments([oldAttachment]);
		await tick();
		sendButton().click();
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

		thread.selectThread('thread-b');
		await tick();
		typeInto(input, 'keep in B');
		context.addAttachments([generationTwoAttachment]);
		await tick();
		message.resolve({});
		await tick();

		expect(thread.threadId).toBe('thread-b');
		expect(input.value).toBe('keep in B');
		expect(
			context.attachments.map((attachment) => ('key' in attachment ? attachment.key : ''))
		).toEqual(['generation-two-file']);
	});

	it('later support text cleared before assignment is not rolled back', async () => {
		const thread = new SupportThreadContext();
		thread.startNewThread();
		const context = new ChatUIContext(thread as unknown as ChatCore, client);
		const creation = Promise.withResolvers<{
			threadId: string;
			notificationEmail: null;
		}>();
		vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') return creation.promise;
			if (name === 'support/messages:sendMessage') return Promise.resolve({});
			return Promise.resolve({});
		});
		await mountSupport(thread, context);
		const input = document.querySelector('textarea')!;
		typeInto(input, 'send this');
		await tick();
		sendButton().click();
		await tick();
		typeInto(input, 'later text');
		typeInto(input, '');

		creation.resolve({ threadId: 'assigned-after-clear', notificationEmail: null });
		await vi.waitFor(() => expect(thread.threadId).toBe('assigned-after-clear'));
		await tick();

		expect(input.value).toBe('');
		expect(thread.getDraft('assigned-after-clear')).toBe('');
	});
});

describe('AI chatbar session lifecycle', () => {
	it.each([
		{
			boundary: 'goBack',
			navigate: (thread: SupportThreadContext) => thread.goBack(),
			oldOutcome: 'fulfilled' as const
		},
		{
			boundary: 'selectThreadFromUrl',
			navigate: (thread: SupportThreadContext) => thread.selectThreadFromUrl('thread-b-b-b'),
			oldOutcome: 'rejected' as const
		}
	])(
		'$boundary releases an abandoned acquisition without letting it disturb a newer send',
		async ({ boundary, navigate, oldOutcome }) => {
			const thread = new SupportThreadContext();
			const oldCreation = Promise.withResolvers<{
				threadId: string;
				notificationEmail: null;
			}>();
			const newerCreation = Promise.withResolvers<{
				threadId: string;
				notificationEmail: null;
			}>();
			const newerMessage = Promise.withResolvers<Record<string, never>>();
			const oldError = new Error('Old acquisition rejected');
			let warmCalls = 0;
			const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				const name = getFunctionName(reference);
				if (name === 'support/threads:getOrCreateWarmThread') {
					warmCalls++;
					if (warmCalls === 1) {
						return Promise.resolve({ threadId: 'chatbar-warm-thread', notificationEmail: null });
					}
					return warmCalls === 2 ? oldCreation.promise : newerCreation.promise;
				}
				if (name === 'support/messages:sendMessage') return newerMessage.promise;
				return Promise.resolve({});
			});
			vi.spyOn(client, 'onUpdate').mockReturnValue(mockUnsubscribe());
			const input = await mountChatbar(thread);
			typeInto(input, 'visible prompt');
			await settleComponentWork();
			expect(mutation).toHaveBeenCalledTimes(1);

			const oldSend = thread.sendMessage(client, 'old prompt');
			await settleComponentWork();
			expect(mutation).toHaveBeenCalledTimes(2);
			expect(thread.isSending).toBe(true);
			expect(sendButton().disabled).toBe(true);
			expect(sendLoader()).not.toBeNull();

			flushSync(() => navigate(thread));
			expect(thread.isSending).toBe(false);
			expect(sendButton().disabled).toBe(false);
			expect(sendLoader()).toBeNull();

			const newerSend = thread.sendMessage(client, 'newer prompt');
			await settleComponentWork();
			expect(mutation).toHaveBeenCalledTimes(3);
			expect(thread.isSending).toBe(true);
			expect(sendLoader()).not.toBeNull();

			if (oldOutcome === 'fulfilled') {
				oldCreation.resolve({ threadId: 'old-created-thread', notificationEmail: null });
				await expect(oldSend).rejects.toThrow('Support conversation changed');
			} else {
				oldCreation.reject(oldError);
				await expect(oldSend).rejects.toBe(oldError);
			}
			await settleComponentWork();
			expect(thread.isSending).toBe(true);
			expect(sendLoader()).not.toBeNull();
			expect(thread.error).toBeNull();

			if (boundary === 'goBack') {
				newerCreation.resolve({ threadId: 'newer-created-thread', notificationEmail: null });
				await settleComponentWork();
			}
			newerMessage.resolve({});
			await expect(newerSend).resolves.toEqual({
				threadId: boundary === 'goBack' ? 'newer-created-thread' : 'thread-b-b-b',
				threadCreated: boundary === 'goBack'
			});
		}
	);

	it('keeps an existing thread locked while its dispatched mutation completes behind the overview', async () => {
		const thread = new SupportThreadContext();
		thread.selectThread('existing-thread');
		const message = Promise.withResolvers<Record<string, never>>();
		const mutation = vi
			.spyOn(client, 'mutation')
			.mockImplementation((reference) =>
				getFunctionName(reference) === 'support/messages:sendMessage'
					? message.promise
					: Promise.resolve({})
			);
		await mountChatbar(thread);
		const result = thread.sendMessage(client, 'existing thread prompt');
		await settleComponentWork();
		expect(mutation).toHaveBeenCalledTimes(1);

		flushSync(() => thread.goBack());
		expect(thread.isSending).toBe(true);
		expect(sendLoader()).not.toBeNull();
		flushSync(() => thread.selectThread('existing-thread'));
		expect(thread.isSending).toBe(true);
		expect(sendLoader()).not.toBeNull();

		message.resolve({});
		await expect(result).resolves.toEqual({
			threadId: 'existing-thread',
			threadCreated: false
		});
		expect(thread.isSending).toBe(false);
		expect(thread.isAwaitingStream).toBe(true);

		thread.goBack();
		expect(thread.isAwaitingStream).toBe(true);
	});

	it.each(['success', 'rejection'] as const)(
		'forgets input and ignores stale warm creation $0 after session clear',
		async (outcome) => {
			const thread = new SupportThreadContext();
			const first = Promise.withResolvers<{ threadId: string; notificationEmail: null }>();
			const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
				if (getFunctionName(reference) !== 'support/threads:getOrCreateWarmThread') {
					throw new Error('A stale warm thread must not send a message');
				}
				return mutation.mock.calls.length === 1
					? first.promise
					: Promise.resolve({ threadId: 'new-warm-thread', notificationEmail: null });
			});
			const onUpdate = vi.spyOn(client, 'onUpdate').mockReturnValue(mockUnsubscribe());
			const input = await mountChatbar(thread);
			typeInto(input, 'old chatbar input');
			await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

			clearPersistedChatState();
			if (outcome === 'success') {
				first.resolve({ threadId: 'old-warm-thread', notificationEmail: null });
			} else {
				first.reject(new Error('Old creation rejected'));
			}
			await tick();

			expect(input.value).toBe('');
			expect(thread.threadId).toBeNull();
			expect(onUpdate).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();

			typeInto(input, 'new chatbar input');
			await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
		}
	);

	it('retires a replaced warm subscription without its old timer touching the replacement', async () => {
		vi.useFakeTimers();
		const firstUnsubscribe = mockUnsubscribe();
		const secondUnsubscribe = mockUnsubscribe();
		const onUpdate = vi
			.spyOn(client, 'onUpdate')
			.mockReturnValueOnce(firstUnsubscribe)
			.mockReturnValueOnce(secondUnsubscribe);
		const message = Promise.withResolvers<Record<string, never>>();
		let warmThread = 0;
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				warmThread++;
				return Promise.resolve({ threadId: `warm-thread-${warmThread}`, notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return message.promise;
			return Promise.resolve({});
		});
		const input = await mountChatbar(new SupportThreadContext());
		typeInto(input, 'first prompt');
		await settleComponentWork();
		expect(onUpdate).toHaveBeenCalledTimes(1);
		sendButton().click();
		await settleComponentWork();
		await settleComponentWork();
		expect(mutation.mock.calls.map(([reference]) => getFunctionName(reference))).toEqual([
			'support/threads:getOrCreateWarmThread',
			'support/messages:sendMessage'
		]);
		message.resolve({});
		await settleComponentWork();
		await settleComponentWork();

		await vi.advanceTimersByTimeAsync(250);
		typeInto(input, 'second prompt');
		await settleComponentWork();
		expect(onUpdate).toHaveBeenCalledTimes(2);
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(250);
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).not.toHaveBeenCalled();

		clearPersistedChatState();
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('releases an unreplaced warm subscription once after the grace period', async () => {
		vi.useFakeTimers();
		const unsubscribe = mockUnsubscribe();
		const onUpdate = vi.spyOn(client, 'onUpdate').mockReturnValue(unsubscribe);
		const message = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				return Promise.resolve({ threadId: 'ordinary-warm-thread', notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return message.promise;
			return Promise.resolve({});
		});
		const input = await mountChatbar(new SupportThreadContext());
		typeInto(input, 'ordinary prompt');
		await settleComponentWork();
		expect(onUpdate).toHaveBeenCalledTimes(1);
		sendButton().click();
		await settleComponentWork();
		await settleComponentWork();
		expect(mutation).toHaveBeenCalledTimes(2);
		message.resolve({});
		await settleComponentWork();
		await settleComponentWork();

		await vi.advanceTimersByTimeAsync(499);
		expect(unsubscribe).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(unsubscribe).toHaveBeenCalledTimes(1);

		clearPersistedChatState();
		await unmount(component!);
		component = undefined;
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('releases the current replacement on unmount without repeating the retired owner', async () => {
		vi.useFakeTimers();
		const firstUnsubscribe = mockUnsubscribe();
		const secondUnsubscribe = mockUnsubscribe();
		const onUpdate = vi
			.spyOn(client, 'onUpdate')
			.mockReturnValueOnce(firstUnsubscribe)
			.mockReturnValueOnce(secondUnsubscribe);
		const message = Promise.withResolvers<Record<string, never>>();
		let warmThread = 0;
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				warmThread++;
				return Promise.resolve({ threadId: `unmount-warm-${warmThread}`, notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return message.promise;
			return Promise.resolve({});
		});
		const input = await mountChatbar(new SupportThreadContext());
		typeInto(input, 'first prompt');
		await settleComponentWork();
		expect(onUpdate).toHaveBeenCalledTimes(1);
		sendButton().click();
		await settleComponentWork();
		await settleComponentWork();
		expect(mutation).toHaveBeenCalledTimes(2);
		message.resolve({});
		await settleComponentWork();
		await settleComponentWork();
		typeInto(input, 'replacement prompt');
		await settleComponentWork();
		expect(onUpdate).toHaveBeenCalledTimes(2);

		await unmount(component!);
		component = undefined;
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
		expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('releases a prewarmed subscription when the session ends', async () => {
		const thread = new SupportThreadContext();
		vi.spyOn(client, 'mutation').mockResolvedValue({
			threadId: 'prewarmed-thread',
			notificationEmail: null
		});
		const unsubscribe = mockUnsubscribe();
		const onUpdate = vi.spyOn(client, 'onUpdate').mockReturnValue(unsubscribe);
		const input = await mountChatbar(thread);
		typeInto(input, 'prewarm this');
		await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));

		clearPersistedChatState();
		await tick();

		expect(input.value).toBe('');
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(thread.threadId).toBeNull();
	});

	it('stops after session clear during the render tick before sending', async () => {
		const thread = new SupportThreadContext();
		const mutation = vi.spyOn(client, 'mutation').mockResolvedValue({
			threadId: 'tick-thread',
			notificationEmail: null
		});
		const unsubscribe = mockUnsubscribe();
		vi.spyOn(client, 'onUpdate').mockReturnValue(unsubscribe);
		const input = await mountChatbar(thread);
		typeInto(input, 'send after prewarm');
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
		await tick();
		thread.setOnThreadChange((threadId) => {
			if (threadId === 'tick-thread') clearPersistedChatState();
		});

		sendButton().click();
		await tick();

		expect(thread.threadId).toBeNull();
		expect(input.value).toBe('');
		expect(mutation).toHaveBeenCalledTimes(1);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(toast.error).not.toHaveBeenCalled();
	});
});
