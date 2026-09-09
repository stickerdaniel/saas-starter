import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import en from '../../../i18n/en.json';
import { ChatUIContext } from '../ui/chat-context.svelte.ts';
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

type ContentProps = ComponentProps<typeof SimpleChat>;
type RejectsApiOverride = 'api' extends keyof ContentProps ? false : true;

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

function mountChat(threadId: string, provideTolgee = true) {
	const contentProps: ContentProps = { threadId };
	const provider = mount(ChatTestProvider<ContentProps>, {
		target: document.body,
		props: { client, content: SimpleChat, contentProps, provideTolgee }
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

function pasteItems(input: HTMLTextAreaElement, items: DataTransferItem[]) {
	const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
	Object.defineProperty(event, 'clipboardData', {
		value: { items },
		configurable: true
	});
	input.dispatchEvent(event);
	return event;
}

function storedDrafts(): Record<string, string> {
	return JSON.parse(localStorage.getItem('drafts:simple-chat') ?? '{}');
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

		provider.setContentProps({ threadId: 'thread-after' });
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

	it('restores the exact origin draft after switching away from a rejected send', async () => {
		const pending = Promise.withResolvers<never>();
		const error = new Error('Send rejected');
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const exactText = '  Retry in thread A  ';
		const { button } = await enterMessage(exactText);
		button.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!.value
		).toBe('');
		expect(storedDrafts()).toEqual({ 'thread-a': exactText });
		pending.reject(error);
		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledWith('[ChatInput] onSend failed:', error)
		);
		const { button: selectedButton } = await enterMessage('Thread B stays independent');
		expect(selectedButton.disabled).toBe(false);

		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!.value
		).toBe(exactText);
	});

	it('keeps the selected thread sendable when an origin send succeeds', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockImplementation((_reference, args) => {
			return (args as { threadId?: string }).threadId === 'thread-a'
				? pending.promise
				: Promise.resolve({});
		});
		const provider = mountChat('thread-a');
		await tick();
		const { button: originButton } = await enterMessage('Send from A');
		originButton.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		const { button: selectedButton } = await enterMessage('Send from B');
		expect(selectedButton.disabled).toBe(false);
		pending.resolve({});
		await vi.waitFor(() => expect(storedDrafts()).toEqual({ 'thread-b': 'Send from B' }));
		expect(selectedButton.disabled).toBe(false);

		selectedButton.click();
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
		expect(mutation.mock.calls[1]?.[1]).toEqual({
			threadId: 'thread-b',
			prompt: 'Send from B',
			userId: undefined,
			fileIds: undefined
		});
	});

	it.each([
		{ name: 'file-only', includeText: false },
		{ name: 'mixed', includeText: true }
	])('ignores $name clipboard files when uploads are hidden', async ({ includeText }) => {
		mountChat('thread-paste');
		await tick();
		const uploadFile = vi.spyOn(ChatUIContext.prototype, 'uploadFile');
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
		const fileItem = {
			kind: 'file',
			type: file.type,
			getAsFile: () => file
		} as DataTransferItem;
		const textItem = {
			kind: 'string',
			type: 'text/plain',
			getAsFile: () => null
		} as DataTransferItem;
		const event = pasteItems(input, includeText ? [textItem, fileItem] : [fileItem]);
		await tick();

		expect(event.defaultPrevented).toBe(false);
		expect(uploadFile).not.toHaveBeenCalled();
	});

	it('does not accept an API override prop', () => {
		const rejectsApiOverride: RejectsApiOverride = true;
		expect(rejectsApiOverride).toBe(true);
	});

	it('requires the documented TolgeeProvider context', () => {
		expect(() => mountChat('thread-without-tolgee', false)).toThrow(/TolgeeProvider/);
	});
});
