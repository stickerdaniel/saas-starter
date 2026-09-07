import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { ChatCore } from '../core/chat-core.svelte.ts';
import type { Attachment } from '../core/types.js';
import { ChatUIContext } from './chat-context.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatInputHarness from './test-fixtures/ChatInputHarness.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
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
let ctx: ChatUIContext;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	ctx = new ChatUIContext(
		new ChatCore({
			threadId: 'thread-input',
			api: { sendMessage: api.aiChat.messages.sendMessage }
		}),
		client
	);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// jsdom has no object URL implementation.
	Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	ctx.dispose();
	await client.close();
	vi.restoreAllMocks();
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
			addAttachment ? [newer] : [{ ...attachments[0], preview: undefined }, attachments[1]]
		);
	});
});
