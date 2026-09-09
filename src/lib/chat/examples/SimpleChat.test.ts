import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import en from '../../../i18n/en.json';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { ChatUIContext } from '../ui/chat-context.svelte.ts';
import { capturedChatMessages } from '../ui/test-fixtures/CapturedChatMessages.svelte';
import ChatTestProvider from '../ui/test-fixtures/ChatTestProvider.svelte';
import SimpleChatOwnersHarness, {
	simpleChatOwnersHarness
} from '../ui/test-fixtures/SimpleChatOwnersHarness.svelte';
import SimpleChat from './SimpleChat.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/chat/ui/ChatMessages.svelte', async () => ({
	default: (await import('../ui/test-fixtures/CapturedChatMessages.svelte')).default
}));
vi.mock('$lib/chat/ui/ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

type ContentProps = ComponentProps<typeof SimpleChat>;
type RejectsApiOverride = 'api' extends keyof ContentProps ? false : true;

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	localStorage.clear();
	delete capturedChatMessages.context;
	delete simpleChatOwnersHarness.setFirstThreadId;
	delete simpleChatOwnersHarness.setSecondThreadId;
	delete simpleChatOwnersHarness.hideFirst;
	delete simpleChatOwnersHarness.hideSecond;
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

function mountOwners(firstThreadId: string, secondThreadId: string) {
	const contentProps = { firstThreadId, secondThreadId };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: SimpleChatOwnersHarness, contentProps }
	});
}

function ownerComposer(owner: 'first' | 'second') {
	const surface = document.querySelector<HTMLElement>(`[data-simple-chat-owner="${owner}"]`)!;
	return {
		input: surface.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!,
		button: surface.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!
	};
}

async function setOwnerComposerValue(owner: 'first' | 'second', value: string) {
	const composer = ownerComposer(owner);
	composer.input.value = value;
	composer.input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	return ownerComposer(owner);
}

async function setComposerValue(value: string) {
	const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
	return { input, button };
}

async function enterMessage(value: string) {
	const composer = await setComposerValue(value);
	expect(composer.button.disabled).toBe(false);
	return composer;
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

	it('keeps an origin send locked when returning before rejection', async () => {
		const pending = Promise.withResolvers<never>();
		const error = new Error('Send rejected');
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const exactText = '  Retry after returning to A  ';
		const { button: originButton } = await enterMessage(exactText);
		originButton.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
		expect(input.value).toBe('');
		expect(button.disabled).toBe(true);
		expect(capturedChatMessages.context?.core.isSending).toBe(true);
		button.click();
		expect(mutation).toHaveBeenCalledTimes(1);

		pending.reject(error);
		await vi.waitFor(() => expect(input.value).toBe(exactText));
		expect(button.disabled).toBe(false);
		expect(capturedChatMessages.context?.core.isSending).toBe(false);
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('clears an unchanged origin after returning before success and keeps awaiting locked', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const { button: originButton } = await enterMessage('Send once from A');
		originButton.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
		expect(input.value).toBe('');
		expect(capturedChatMessages.context?.core.isSending).toBe(true);

		pending.resolve({});
		await vi.waitFor(() => expect(capturedChatMessages.context?.core.isSending).toBe(false));
		expect(storedDrafts()).toEqual({});
		expect(input.value).toBe('');
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(true);
		button.click();
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('preserves a same-text new edit through locked remounts and success', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const sentDraft = 'Original A draft';
		const { button: originButton } = await enterMessage(sentDraft);
		originButton.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const newerDraft = sentDraft;
		const { button: lockedButton } = await setComposerValue(newerDraft);
		expect(lockedButton.disabled).toBe(true);
		expect(storedDrafts()).toEqual({ 'thread-a': newerDraft });

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		expect(input.value).toBe(newerDraft);
		expect(
			document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!.disabled
		).toBe(true);
		expect(mutation).toHaveBeenCalledTimes(1);

		pending.resolve({});
		await vi.waitFor(() => expect(capturedChatMessages.context?.core.isSending).toBe(false));
		expect(storedDrafts()).toEqual({ 'thread-a': newerDraft });
		expect(input.value).toBe(newerDraft);
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(true);
		capturedChatMessages.context?.core.setAwaitingStream(false);
		await tick();
		expect(storedDrafts()).toEqual({ 'thread-a': newerDraft });
		expect(input.value).toBe(newerDraft);
		expect(
			document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!.disabled
		).toBe(false);
	});

	it('preserves a genuine edit through repeated locked remounts and rejection', async () => {
		const pending = Promise.withResolvers<never>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const { button: originButton } = await enterMessage('Rejected A draft');
		originButton.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const newerDraft = 'Keep this newer A draft';
		const { button: lockedButton } = await setComposerValue(newerDraft);
		expect(lockedButton.disabled).toBe(true);

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		expect(input.value).toBe(newerDraft);
		expect(mutation).toHaveBeenCalledTimes(1);

		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(capturedChatMessages.context?.core.isSending).toBe(false));
		expect(input.value).toBe(newerDraft);
		expect(storedDrafts()).toEqual({ 'thread-a': newerDraft });
		expect(
			document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!.disabled
		).toBe(false);
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('releases an inactive retained session after its stream lock ends', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const provider = mountChat('thread-a');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		const { button } = await enterMessage('Observe the stream lifecycle');
		button.click();
		await tick();

		provider.setContentProps({ threadId: 'thread-b' });
		await tick();
		pending.resolve({});
		await vi.waitFor(() => expect(originCore.isAwaitingStream).toBe(true));
		originCore.setAwaitingStream(false);
		await tick();
		provider.setContentProps({ threadId: 'thread-a' });
		await tick();

		expect(capturedChatMessages.context?.core).not.toBe(originCore);
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(false);
	});

	it('retains an in-flight rejection across a full provider remount', async () => {
		const pending = Promise.withResolvers<never>();
		const error = new Error('Send rejected');
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-a');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		const exactText = '  Retry after a full remount  ';
		const { button: originButton } = await enterMessage(exactText);
		originButton.click();
		await tick();

		await unmount(component!);
		component = undefined;
		mountChat('thread-a');
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
		expect(capturedChatMessages.context?.core).toBe(originCore);
		expect(input.value).toBe('');
		expect(button.disabled).toBe(true);
		expect(mutation).toHaveBeenCalledTimes(1);

		pending.reject(error);
		await vi.waitFor(() => expect(input.value).toBe(exactText));
		expect(button.disabled).toBe(false);
		expect(storedDrafts()).toEqual({ 'thread-a': exactText });
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('retains an in-flight success across a full provider remount', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-a');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		const { button: originButton } = await enterMessage('Send across a full remount');
		originButton.click();
		await tick();

		await unmount(component!);
		component = undefined;
		mountChat('thread-a');
		await tick();
		const input = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="chat-input-textarea"]'
		)!;
		const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]')!;
		expect(capturedChatMessages.context?.core).toBe(originCore);
		expect(input.value).toBe('');
		expect(button.disabled).toBe(true);

		pending.resolve({});
		await vi.waitFor(() => expect(originCore.isSending).toBe(false));
		expect(originCore.isAwaitingStream).toBe(true);
		expect(input.value).toBe('');
		expect(storedDrafts()).toEqual({});
		button.click();
		expect(mutation).toHaveBeenCalledTimes(1);

		originCore.setAwaitingStream(false);
		await tick();
		await unmount(component!);
		component = undefined;
		mountChat('thread-a');
		await tick();
		expect(capturedChatMessages.context?.core).not.toBe(originCore);
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(false);
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!.value
		).toBe('');
	});

	it('cleans up an ownerless rejection before a later mount', async () => {
		const pending = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-a');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		const exactText = '  Restore after ownerless rejection  ';
		const { button } = await enterMessage(exactText);
		button.click();
		await tick();
		await unmount(component!);
		component = undefined;

		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(originCore.isSending).toBe(false));
		mountChat('thread-a');
		await tick();
		expect(capturedChatMessages.context?.core).not.toBe(originCore);
		expect(capturedChatMessages.context?.core.isSending).toBe(false);
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!.value
		).toBe(exactText);
	});

	it('does not retain idle core state across sequential mounts', async () => {
		mountChat('thread-a');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		originCore.setError('stale error');
		await unmount(component!);
		component = undefined;

		mountChat('thread-a');
		await tick();
		expect(capturedChatMessages.context?.core).not.toBe(originCore);
		expect(capturedChatMessages.context?.core.error).toBeNull();
		expect(capturedChatMessages.context?.core.isSending).toBe(false);
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(false);
	});

	it('discards an ownerless awaiting session after the chat epoch changes', async () => {
		const pending = Promise.withResolvers<Record<string, never>>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const onUpdate = vi.spyOn(client, 'onUpdate');
		mountChat('thread-before-logout');
		await tick();
		const originCore = capturedChatMessages.context!.core;
		const { button } = await enterMessage('Do not retain this session');
		button.click();
		await tick();
		await unmount(component!);
		component = undefined;
		pending.resolve({});
		await vi.waitFor(() => expect(originCore.isAwaitingStream).toBe(true));

		clearPersistedChatState();
		onUpdate.mockClear();
		mountChat('thread-after-logout');
		await tick();
		const subscribedThreads = onUpdate.mock.calls.map(([, args]) =>
			'threadId' in args ? args.threadId : undefined
		);

		expect(subscribedThreads).not.toContain('thread-before-logout');
		expect(
			document.querySelector(
				'[data-testid="simple-chat-session-observer"][data-thread-id="thread-before-logout"]'
			)
		).toBeNull();
		expect(capturedChatMessages.context?.core).not.toBe(originCore);
		expect(capturedChatMessages.context?.core.isSending).toBe(false);
		expect(capturedChatMessages.context?.core.isAwaitingStream).toBe(false);
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input-textarea"]')!.value
		).toBe('');
		expect(storedDrafts()).toEqual({});
	});

	it('keeps stale async callbacks out of the replacement epoch registry', async () => {
		const pending = Promise.withResolvers<never>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountChat('thread-a');
		await tick();
		const oldCore = capturedChatMessages.context!.core;
		const { button } = await enterMessage('Old session draft');
		button.click();
		await tick();
		await unmount(component!);
		component = undefined;

		clearPersistedChatState();
		mountChat('thread-a');
		await tick();
		const newCore = capturedChatMessages.context!.core;
		const newDraft = 'New session draft';
		const { input } = await enterMessage(newDraft);
		pending.reject(new Error('Old session rejected'));
		await tick();
		await Promise.resolve();

		expect(newCore).not.toBe(oldCore);
		expect(capturedChatMessages.context?.core).toBe(newCore);
		expect(input.value).toBe(newDraft);
		expect(storedDrafts()).toEqual({ 'thread-a': newDraft });
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ hidden: 'first' as const, remaining: 'second' as const },
		{ hidden: 'second' as const, remaining: 'first' as const }
	])('shares one thread context when the $hidden owner unmounts', async ({ hidden, remaining }) => {
		const pending = Promise.withResolvers<never>();
		const mutation = vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		mountOwners('thread-shared', 'thread-shared');
		await tick();

		await setOwnerComposerValue('first', 'Draft from first');
		expect(ownerComposer('second').input.value).toBe('Draft from first');
		const sharedDraft = 'Draft from second';
		await setOwnerComposerValue('second', sharedDraft);
		expect(ownerComposer('first').input.value).toBe(sharedDraft);

		ownerComposer('first').button.click();
		await tick();
		expect(ownerComposer('first').input.value).toBe('');
		expect(ownerComposer('second').input.value).toBe('');
		expect(ownerComposer('first').button.disabled).toBe(true);
		expect(ownerComposer('second').button.disabled).toBe(true);
		ownerComposer('second').button.click();
		expect(mutation).toHaveBeenCalledTimes(1);

		if (hidden === 'first') simpleChatOwnersHarness.hideFirst?.();
		else simpleChatOwnersHarness.hideSecond?.();
		await tick();
		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(ownerComposer(remaining).input.value).toBe(sharedDraft));
		expect(ownerComposer(remaining).button.disabled).toBe(false);
		expect(storedDrafts()).toEqual({ 'thread-shared': sharedDraft });
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('renders one retained observer and transfers primary ownership', async () => {
		const pending = Promise.withResolvers<never>();
		vi.spyOn(client, 'mutation').mockReturnValue(pending.promise);
		const observersFor = (threadId: string) =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					`[data-testid="simple-chat-session-observer"][data-thread-id="${threadId}"]`
				)
			);
		mountOwners('thread-a', 'thread-c');
		await tick();
		await setOwnerComposerValue('first', 'Retain A while hidden');
		ownerComposer('first').button.click();
		await tick();

		simpleChatOwnersHarness.setFirstThreadId?.('thread-b');
		await vi.waitFor(() => expect(observersFor('thread-a')).toHaveLength(1));
		const firstObserver = observersFor('thread-a')[0];

		simpleChatOwnersHarness.hideFirst?.();
		await vi.waitFor(() => expect(observersFor('thread-a')).toHaveLength(1));
		expect(observersFor('thread-a')[0]).not.toBe(firstObserver);

		pending.reject(new Error('Send rejected'));
		await vi.waitFor(() => expect(observersFor('thread-a')).toHaveLength(0));
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
