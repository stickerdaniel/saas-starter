import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { getFunctionName } from 'convex/server';
import { SupportThreadContext } from '$lib/components/customer-support/support-thread-context.svelte.ts';
import { ChatCore } from '../core/chat-core.svelte.ts';
import { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import type { Attachment } from '../core/types.js';
import { ChatUIContext } from './chat-context.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatInputHarness from './test-fixtures/ChatInputHarness.svelte';
import KeyedChatInputLifecycleHarness, {
	keyedChatInputLifecycle
} from './test-fixtures/KeyedChatInputLifecycleHarness.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));

const attachments: Attachment[] = [
	{
		type: 'screenshot',
		key: 'screenshot-first',
		name: 'screenshot.png',
		size: 2048,
		mimeType: 'image/png',
		preview: 'blob:https://chat.test/screenshot',
		url: 'https://chat.test/screenshot.png',
		width: 800,
		height: 600,
		uploadState: { status: 'success', progress: 100, fileId: 'screenshot-file' }
	},
	{
		type: 'file',
		key: 'document-second',
		name: 'notes.txt',
		size: 42,
		mimeType: 'text/plain',
		url: 'https://chat.test/notes.txt',
		uploadState: { status: 'success', progress: 100, fileId: 'document-file' }
	}
];

const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
let core: ChatCore;
let ctx: ChatUIContext;
let surface: string;

function stallUpload() {
	const handlers: Record<string, () => void> = {};
	const abort = vi.fn(() => handlers.abort?.());
	vi.stubGlobal('XMLHttpRequest', function XMLHttpRequestStub() {
		return {
			status: 200,
			responseText: '',
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				handlers[event] = handler;
			},
			open: () => {},
			setRequestHeader: () => {},
			abort,
			send: () => {}
		};
	});
	return abort;
}

function createContext(threadId: string | null): ChatUIContext {
	const contextCore = new ChatCore({
		threadId,
		api: { sendMessage: api.aiChat.messages.sendMessage }
	});
	core = contextCore;
	return new ChatUIContext(
		contextCore,
		client,
		{
			generateUploadUrl: api.aiChat.files.generateUploadUrl,
			saveUploadedFile: api.aiChat.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore(surface)
		},
		'right',
		null,
		{
			bindThreadOrigin: (binder) => contextCore.setThreadOriginBinder(binder),
			forgetSession: () => contextCore.forgetChatSession()
		}
	);
}

beforeEach(() => {
	localStorage.clear();
	surface = 'chat-input-' + Math.random();
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	ctx = createContext('thread-input');
	ctx.setDisplayMessages([]);
	delete keyedChatInputLifecycle.context;
	delete keyedChatInputLifecycle.setThreadId;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// jsdom has no object URL implementation.
	Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	ctx.dispose();
	await client.close();
	localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (originalRevokeObjectURL) {
		Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
	} else {
		Reflect.deleteProperty(URL, 'revokeObjectURL');
	}
});

async function startSend() {
	const pending = Promise.withResolvers<void>();
	const onSend = vi.fn(() => {
		expect(ctx.inputValue).toBe('');
		expect(ctx.attachments).toEqual(attachments);
		return pending.promise;
	});
	const contentProps = { context: ctx, onSend };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: ChatInputHarness, contentProps }
	});
	await tick();
	const input = document.querySelector('textarea')!;
	input.value = 'Retry this message';
	input.dispatchEvent(new Event('input', { bubbles: true }));
	ctx.addAttachments(attachments);
	await tick();
	const button = document.querySelector<HTMLButtonElement>(
		`button[aria-label="${en.chat.aria.send}"]`
	)!;
	expect(button.disabled).toBe(false);
	button.click();
	await tick();
	expect(onSend).toHaveBeenCalledExactlyOnceWith('Retry this message');
	expect(input.value).toBe('');
	expect(ctx.attachments).toEqual([]);
	return { pending, input };
}

describe('ChatInput send rollback through ChatRoot', () => {
	it('restores text and the ordered attachment snapshot without revoked blob previews', async () => {
		const { pending, input } = await startSend();
		const error = new Error('Send rejected');
		pending.reject(error);
		await tick();

		expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error);
		await vi.waitFor(() => expect(input.value).toBe('Retry this message'));
		expect(ctx.attachments).toEqual([{ ...attachments[0], preview: undefined }, attachments[1]]);
		expect(ctx.uploadedFileIds).toEqual(['screenshot-file', 'document-file']);
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
			'blob:https://chat.test/screenshot'
		);
	});

	it('keeps the composer cleared when sending succeeds', async () => {
		const { pending, input } = await startSend();
		pending.resolve();
		await tick();

		expect(input.value).toBe('');
		expect(ctx.attachments).toEqual([]);
		expect(console.error).not.toHaveBeenCalled();
	});

	it.each([
		{ name: 'text', editText: true, addAttachment: false },
		{ name: 'attachments', editText: false, addAttachment: true },
		{ name: 'text and attachments', editText: true, addAttachment: true }
	])('preserves $name added while the send is pending', async ({ editText, addAttachment }) => {
		const { pending, input } = await startSend();
		if (editText) {
			input.value = 'A newer draft';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		const newer: Attachment = { type: 'image', url: 'https://chat.test/newer.png' };
		if (addAttachment) ctx.addAttachments([newer]);
		const error = new Error('Send rejected');
		pending.reject(error);
		await tick();

		expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error);
		await vi.waitFor(() =>
			expect(input.value).toBe(editText ? 'A newer draft' : 'Retry this message')
		);
		expect(ctx.attachments).toEqual(
			addAttachment
				? [{ ...attachments[0], preview: undefined }, attachments[1], newer]
				: [{ ...attachments[0], preview: undefined }, attachments[1]]
		);
	});

	it('merges the rejected snapshot before a later active upload without aborting it', async () => {
		const { pending } = await startSend();
		vi.spyOn(client, 'mutation').mockResolvedValue({
			uploadUrl: 'https://storage.test',
			uploadToken: 'token'
		});
		const abort = stallUpload();
		void ctx.uploadFile(new File(['later'], 'later.txt', { type: 'text/plain' }));
		await vi.waitFor(() => expect(ctx.hasUploadingFiles).toBe(true));
		const error = new Error('Send rejected');

		pending.reject(error);
		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error)
		);

		expect(
			ctx.attachments.map((attachment) => ('name' in attachment ? attachment.name : ''))
		).toEqual(['screenshot.png', 'notes.txt', 'later.txt']);
		expect(ctx.attachments[2]).toEqual(
			expect.objectContaining({ uploadState: { status: 'uploading', progress: 0 } })
		);
		expect(abort).not.toHaveBeenCalled();
	});

	it('does not restore an origin-thread snapshot into the thread now on screen', async () => {
		const { pending, input } = await startSend();
		core.setThread('thread-b');
		ctx.setDisplayMessages([]);
		const newer: Attachment = { type: 'image', url: 'https://chat.test/thread-b.png' };
		ctx.addAttachments([newer]);
		const restoreStored = vi.spyOn(ctx.uploadConfig!.attachmentStore!, 'restoreThreadAttachments');
		const error = new Error('Send rejected');

		pending.reject(error);
		await tick();

		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error)
		);
		expect(input.value).toBe('');
		expect(ctx.attachments).toEqual([newer]);
		expect(restoreStored).toHaveBeenCalledWith('thread-input', expect.any(Array));
		expect(restoreStored.mock.calls[0]?.[1]).toEqual(attachments);
		expect(
			new ChatAttachmentStore(surface)
				.readThread('thread-input')
				.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		).toEqual(['screenshot-first', 'document-second']);
	});

	it('keeps a created null-origin snapshot bound after later navigation', async () => {
		ctx.dispose();
		ctx = createContext(null);
		core.isNewConversation = true;
		ctx.setDisplayMessages([]);
		const pending = Promise.withResolvers<void>();
		const contentProps = { context: ctx, onSend: () => pending.promise };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ChatInputHarness, contentProps }
		});
		await tick();
		const input = document.querySelector('textarea')!;
		input.value = 'Retry the created conversation';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		ctx.addAttachments(attachments);
		await tick();
		document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
		await tick();
		core.threadId = 'thread-created';
		ctx.setDisplayMessages([]);
		core.threadId = 'thread-b';
		core.isNewConversation = false;
		ctx.setDisplayMessages([]);
		const newer: Attachment = { type: 'image', url: 'https://chat.test/thread-b.png' };
		ctx.addAttachments([newer]);

		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(console.error).toHaveBeenCalled());

		expect(input.value).toBe('');
		expect(ctx.attachments).toEqual([newer]);
		expect(
			new ChatAttachmentStore(surface)
				.readThread('thread-created')
				.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		).toEqual(['screenshot-first', 'document-second']);
	});

	it('restores a keyed admin origin after its context is disposed', async () => {
		ctx.dispose();
		const pending = Promise.withResolvers<void>();
		const onSend = vi.fn(() => pending.promise);
		const contentProps = { initialThreadId: 'thread-admin-a', surface, onSend };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: KeyedChatInputLifecycleHarness, contentProps }
		});
		await tick();
		const originContext = keyedChatInputLifecycle.context!;
		const input = document.querySelector('textarea')!;
		input.value = 'Retry the admin reply';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		originContext.addAttachments(attachments);
		await tick();
		document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
		await tick();
		expect(originContext.attachments).toEqual([]);

		flushSync(() => keyedChatInputLifecycle.setThreadId?.('thread-admin-b'));
		await tick();
		expect(keyedChatInputLifecycle.context?.attachments).toEqual([]);
		const error = new Error('Send rejected');
		pending.reject(error);
		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error)
		);
		expect(
			new ChatAttachmentStore(surface)
				.readThread('thread-admin-a')
				.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		).toEqual(['screenshot-first', 'document-second']);

		await unmount(component!);
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: {
				client,
				content: KeyedChatInputLifecycleHarness,
				contentProps: { ...contentProps, initialThreadId: 'thread-admin-a' }
			}
		});
		await tick();
		expect(keyedChatInputLifecycle.context?.core.threadId).toBe('thread-admin-a');
		expect(
			keyedChatInputLifecycle.context?.attachments.map((attachment) =>
				'key' in attachment ? attachment.key : undefined
			)
		).toEqual(['screenshot-first', 'document-second']);
	});

	it('keeps a lazy support conversation retryable after thread creation fails to send', async () => {
		ctx.dispose();
		const support = new SupportThreadContext();
		support.startNewThread();
		ctx = new ChatUIContext(support as unknown as ChatCore, client, {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile,
			attachmentStore: new ChatAttachmentStore(surface)
		});
		ctx.setDisplayMessages([]);
		const error = new Error('Send rejected');
		vi.spyOn(client, 'mutation').mockImplementation((reference) => {
			const name = getFunctionName(reference);
			if (name === 'support/threads:getOrCreateWarmThread') {
				return Promise.resolve({ threadId: 'thread-created', notificationEmail: null });
			}
			if (name === 'support/messages:sendMessage') return Promise.reject(error);
			throw new Error(`Unexpected mutation: ${name}`);
		});
		const onSend = async (prompt: string) => {
			await support.sendMessage(client, prompt, {
				fileIds: ctx.uploadedFileIds,
				attachments: [...ctx.attachments]
			});
		};
		const contentProps = { context: ctx, onSend };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ChatInputHarness, contentProps }
		});
		await tick();
		const input = document.querySelector('textarea')!;
		input.value = 'Retry the new conversation';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		ctx.addAttachments(attachments);
		await tick();
		document.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.aria.send}"]`)!.click();
		await tick();
		await vi.waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(input.value).toBe('Retry the new conversation'));
		expect(support.threadId).toBe('thread-created');
		expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error);
		expect(
			ctx.attachments.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		).toEqual(['screenshot-first', 'document-second']);
		expect(
			new ChatAttachmentStore(surface)
				.readThread('thread-created')
				.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		).toEqual(['screenshot-first', 'document-second']);
	});
});
