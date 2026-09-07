import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { toast } from 'svelte-sonner';
import { ConvexError } from 'convex/values';
import AIThreadChat from '../../../routes/[[lang]]/app/ai-chat/thread-chat.svelte';
import AdminThreadChat from '../../../routes/[[lang]]/admin/support/thread-chat.svelte';
import FeedbackWidget from '../../components/customer-support/feedback-widget.svelte';
import { SupportThreadContext } from '../../components/customer-support/support-thread-context.svelte.ts';
import { ChatUIContext } from './chat-context.svelte.ts';
import type { ChatCore } from '../core/chat-core.svelte.ts';
import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ThreadChatConsumerHarness, {
	threadChatConsumerHarness
} from './test-fixtures/ThreadChatConsumerHarness.svelte';
import { capturedInput } from './test-fixtures/CapturedChatInput.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/chat/ui/ChatInput.svelte', async () => ({
	default: (await import('./test-fixtures/CapturedChatInput.svelte')).default
}));
vi.mock('$lib/chat', async () => ({
	ChatRoot: (await import('./ChatRoot.svelte')).default,
	ChatMessages: () => {},
	ChatInput: (await import('./test-fixtures/CapturedChatInput.svelte')).default
}));
vi.mock('$lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/message-quota-banner.svelte', () => ({ default: () => {} }));
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

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

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

beforeEach(() => {
	localStorage.clear();
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(toast.error).mockClear();
	vi.mocked(haptic.trigger).mockClear();
	delete capturedInput.props;
	delete capturedInput.context;
	delete threadChatConsumerHarness.setThreadId;
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe.each([
	{
		name: 'AI chat',
		content: AIThreadChat,
		contentProps: { threadId: 'thread-ai', hasMessagesAvailable: true },
		mutationName: 'aiChat/messages:sendMessage',
		log: '[AI Chat sendMessage] Error:',
		translation: en.chat.messages.send_failed
	},
	{
		name: 'admin support',
		content: AdminThreadChat,
		contentProps: { threadId: 'thread-admin' },
		mutationName: 'admin/support/mutations:sendAdminReply',
		log: '[Admin sendAdminReply] Error:',
		translation: en.admin.support.chat.send_error
	}
])('$name send callback', ({ content, contentProps, mutationName, log, translation }) => {
	it('rethrows the mutation error after reporting it and leaves input rollback to ChatInput', async () => {
		const error = new Error('Send rejected');
		const pending = Promise.withResolvers<never>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content, contentProps }
		});
		await tick();
		const ctx = capturedInput.context!;
		ctx.addAttachments([
			{
				type: 'file',
				key: 'attached-document',
				name: 'notes.txt',
				size: 42,
				mimeType: 'text/plain',
				uploadState: { status: 'success', progress: 100, fileId: 'document-file' }
			}
		]);
		const restore = vi.spyOn(ctx, 'setInputValue');
		const result = capturedInput.props!.onSend!('Retry this message');
		const rejection = expect
			.soft(result, 'Consumers must reject so ChatInput restores its attachment snapshot')
			.rejects.toBe(error);
		expect(mutation).toHaveBeenCalledTimes(1);
		const [reference, args, options] = mutation.mock.calls[0]!;
		expect(getFunctionName(reference)).toBe(mutationName);
		expect(args).toEqual({
			threadId: contentProps.threadId,
			prompt: 'Retry this message',
			fileIds: ['document-file'],
			...(content === AIThreadChat ? { userId: undefined } : {})
		});
		expect(options?.optimisticUpdate).toBeTypeOf('function');
		pending.reject(error);
		await rejection;

		expect(console.error).toHaveBeenCalledWith(log, error);
		expect(toast.error).toHaveBeenCalledExactlyOnceWith(translation);
		expect(
			restore,
			'Only ChatInput may restore the captured composer state'
		).not.toHaveBeenCalled();
	});

	it('leaves a later pending upload active after success', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockImplementation((reference) =>
			getFunctionName(reference) === mutationName
				? pending.promise
				: Promise.resolve({ uploadUrl: 'https://storage.test', uploadToken: 'token' })
		);
		const abort = stallUpload();
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content, contentProps }
		});
		await tick();
		const ctx = capturedInput.context!;
		ctx.addAttachments([
			{
				type: 'file',
				key: 'sent-file',
				name: 'sent.txt',
				size: 10,
				mimeType: 'text/plain',
				url: 'https://chat.test/sent.txt',
				uploadState: { status: 'success', progress: 100, fileId: 'sent-file-id' }
			}
		]);
		const result = capturedInput.props!.onSend!('Send this');
		ctx.clearAttachments();
		const clearAttachments = vi.spyOn(ctx, 'clearAttachments');
		void ctx.uploadFile(new File(['later'], 'later.txt', { type: 'text/plain' }));
		await vi.waitFor(() => expect(ctx.hasUploadingFiles).toBe(true));

		pending.resolve({});
		await expect(result).resolves.toBeUndefined();

		expect(clearAttachments).not.toHaveBeenCalled();
		expect(abort).not.toHaveBeenCalled();
		expect(ctx.attachments).toEqual([
			expect.objectContaining({
				name: 'later.txt',
				uploadState: { status: 'uploading', progress: 0 }
			})
		]);
	});
});

function storedDrafts(surface: 'ai-chat' | 'admin-support'): Record<string, string> {
	return JSON.parse(localStorage.getItem(`drafts:${surface}`) ?? '{}');
}

describe.each([
	{ kind: 'ai' as const, surface: 'ai-chat' as const },
	{ kind: 'admin' as const, surface: 'admin-support' as const }
])('$kind draft checkpoint', ({ kind, surface }) => {
	async function mountHarness() {
		const contentProps = { kind, initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ThreadChatConsumerHarness, contentProps }
		});
		await tick();
		return capturedInput.context!;
	}

	it('clears only the unchanged origin draft after switching threads', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const ctx = await mountHarness();
		ctx.setInputValue('send from A');
		await tick();
		const result = capturedInput.props!.onSend!('send from A');
		ctx.clearInput();
		threadChatConsumerHarness.setThreadId?.('thread-b');
		await tick();
		capturedInput.context!.setInputValue('keep in B');
		await tick();

		pending.resolve({});
		await expect(result).resolves.toBeUndefined();

		expect(storedDrafts(surface)).toEqual({ 'thread-b': 'keep in B' });
	});

	it.each(['a newer draft', 'send this'])(
		'preserves later same-thread text %s after success',
		async (later) => {
			const pending = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
			const ctx = await mountHarness();
			ctx.setInputValue('send this');
			await tick();
			const result = capturedInput.props!.onSend!('send this');
			ctx.clearInput();
			ctx.setInputValue(later);
			await tick();

			pending.resolve({});
			await expect(result).resolves.toBeUndefined();

			expect(storedDrafts(surface)).toEqual({ 'thread-a': later });
		}
	);
});

describe('AI thread switch failure', () => {
	it('keeps the origin draft and leaves the visible thread unchanged', async () => {
		const error = new Error('Send rejected');
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const contentProps = { kind: 'ai' as const, initialThreadId: 'thread-a' };
		component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ThreadChatConsumerHarness, contentProps }
		});
		await tick();
		const ctx = capturedInput.context!;
		ctx.setInputValue('retry in A');
		await tick();
		const result = capturedInput.props!.onSend!('retry in A');
		ctx.clearInput();
		threadChatConsumerHarness.setThreadId?.('thread-b');
		await tick();

		pending.reject(error);
		await expect(result).rejects.toBe(error);

		expect(capturedInput.context!.inputValue).toBe('');
		expect(storedDrafts('ai-chat')).toEqual({ 'thread-a': 'retry in A' });
	});
});

describe('AI session boundary', () => {
	it.each(['success', 'rejection'] as const)(
		'suppresses stale $0 side effects after session clear',
		async (outcome) => {
			const pending = Promise.withResolvers<Record<string, never>>();
			vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
			const onMessageSent = vi.fn();
			const contentProps = {
				threadId: 'thread-ai',
				hasMessagesAvailable: true,
				onMessageSent
			};
			component = mount(ChatTestProvider<typeof contentProps>, {
				target: document.body,
				props: { client, content: AIThreadChat, contentProps }
			});
			await tick();
			const result = capturedInput.props!.onSend!('old session message');
			clearPersistedChatState();

			if (outcome === 'success') {
				pending.resolve({});
				await expect(result).resolves.toBeUndefined();
			} else {
				const error = new Error('Send rejected');
				pending.reject(error);
				await expect(result).rejects.toBe(error);
			}

			expect(onMessageSent).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
			expect(capturedInput.context?.core.isSending).toBe(false);
			expect(capturedInput.context?.core.isAwaitingStream).toBe(false);
		}
	);
});

describe('support feedback send callback', () => {
	it('keeps rate-limit UX, rethrows the same error, and leaves rollback to ChatInput', async () => {
		const thread = new SupportThreadContext();
		thread.setThread('thread-support');
		thread.currentView = 'chat';
		const ctx = new ChatUIContext(thread as unknown as ChatCore, client);
		const contentProps = { chatUIContext: ctx };
		const error = new ConvexError({ code: 'RATE_LIMITED', retryAfter: 3000 });
		vi.spyOn(client, 'mutation').mockRejectedValue(error);
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
		const restore = vi.spyOn(ctx, 'setInputValue');

		const result = capturedInput.props!.onSend!('Retry this message');

		await expect(result).rejects.toBe(error);
		expect(console.error).toHaveBeenCalledWith('[handleSend] Error:', error);
		expect(thread.isRateLimited).toBe(true);
		expect(haptic.trigger).toHaveBeenCalledExactlyOnceWith('error');
		expect(toast.error).toHaveBeenCalledExactlyOnceWith(
			en.support.widget.error.rate_limit.replace('{seconds}', '3')
		);
		expect(restore).not.toHaveBeenCalled();
		ctx.dispose();
	});

	it('preserves a later support draft after success', async () => {
		const thread = new SupportThreadContext();
		thread.setThread('thread-support');
		thread.currentView = 'chat';
		thread.setDraft('thread-support', 'send this');
		const ctx = new ChatUIContext(thread as unknown as ChatCore, client);
		const contentProps = { chatUIContext: ctx };
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
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
		const result = capturedInput.props!.onSend!('send this');
		ctx.clearInput();
		ctx.setInputValue('keep this');
		thread.setDraft('thread-support', 'keep this');

		pending.resolve({});
		await expect(result).resolves.toBeUndefined();

		expect(thread.getDraft('thread-support')).toBe('keep this');
		ctx.dispose();
	});
});
