import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import { api } from '$lib/convex/_generated/api';
import en from '../../../i18n/en.json';
import ChatTestProvider from '../ui/test-fixtures/ChatTestProvider.svelte';
import SimpleChat from './SimpleChat.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('$lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

const chatApi = {
	sendMessage: api.aiChat.messages.sendMessage,
	listMessages: api.aiChat.messages.listMessages
};

type ContentProps = {
	threadId: string;
	api: typeof chatApi;
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	localStorage.clear();
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	localStorage.clear();
	vi.restoreAllMocks();
});

function mountChat(threadId: string) {
	const contentProps: ContentProps = { threadId, api: chatApi };
	const provider = mount(ChatTestProvider<ContentProps>, {
		target: document.body,
		props: { client, content: SimpleChat, contentProps }
	});
	component = provider;
	return provider;
}

async function enterMessage(value: string) {
	const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
	expect(button.disabled).toBe(false);
	return { input, button };
}

describe('SimpleChat', () => {
	it('sends trimmed text with optimistic state and no attachment controls', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-selected');
		await tick();
		const { input, button } = await enterMessage('  Send this once  ');

		button.click();
		await tick();

		expect(mutation).toHaveBeenCalledTimes(1);
		const [reference, args, options] = mutation.mock.calls[0]!;
		expect(getFunctionName(reference)).toBe('aiChat/messages:sendMessage');
		expect(args).toEqual({
			threadId: 'thread-selected',
			prompt: 'Send this once',
			userId: undefined,
			fileIds: undefined
		});
		expect(options?.optimisticUpdate).toBeTypeOf('function');
		expect(input.value).toBe('');
		expect(button.disabled).toBe(true);
		expect(
			document.querySelector(`button[aria-label="${en.chat.tooltip.attach_files}"]`)
		).toBeNull();
		expect(document.querySelector('input[type="file"]')).toBeNull();

		pending.resolve({});
		await tick();
	});

	it('lets ChatInput restore exact text when the mutation rejects', async () => {
		const pending = Promise.withResolvers<never>();
		const error = new Error('Send rejected');
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-retry');
		await tick();
		const exactText = '  Retry this exactly  ';
		const { input, button } = await enterMessage(exactText);

		button.click();
		await tick();
		expect(input.value).toBe('');
		expect(button.disabled).toBe(true);
		pending.reject(error);

		await vi.waitFor(() => expect(input.value).toBe(exactText));
		expect(button.disabled).toBe(false);
		expect(console.error).toHaveBeenCalledWith(
			'[ChatCore.sendMessage] Failed to send message:',
			error
		);
		expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error);
	});

	it('uses a changed thread ID for the next send', async () => {
		const mutation = vi.spyOn(client, 'mutation').mockResolvedValue({});
		const provider = mountChat('thread-before');
		await tick();

		provider.setContentProps({ threadId: 'thread-after', api: chatApi });
		await tick();
		const { button } = await enterMessage('Use the current thread');
		button.click();

		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
		const [reference, args] = mutation.mock.calls[0]!;
		expect(getFunctionName(reference)).toBe('aiChat/messages:sendMessage');
		expect(args).toEqual({
			threadId: 'thread-after',
			prompt: 'Use the current thread',
			userId: undefined,
			fileIds: undefined
		});
	});
});
