import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { toast } from 'svelte-sonner';
import AIThreadChat from '../../../routes/[[lang]]/app/ai-chat/thread-chat.svelte';
import AdminThreadChat from '../../../routes/[[lang]]/admin/support/thread-chat.svelte';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import { capturedInput } from './test-fixtures/CapturedChatInput.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('$lib/chat/ui/ChatInput.svelte', async () => ({
	default: (await import('./test-fixtures/CapturedChatInput.svelte')).default
}));
vi.mock('$lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/message-quota-banner.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('$lib/auth-client', () => ({ authClient: {} }));
vi.mock('$lib/hooks/use-media.svelte.ts', () => ({ useMedia: () => ({ lg: false }) }));

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	localStorage.clear();
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(toast.error).mockClear();
	delete capturedInput.props;
	delete capturedInput.context;
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	vi.restoreAllMocks();
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
});
