/**
 * The composer options a surface sets to gate writing and attachments, own the
 * feedback for refused files, keep drops on the composer, and add actions
 * around the defaults, and how every file entry point holds at the attachment
 * cap, counting the files of pending sends.
 *
 * Each case renders ChatInput with the props its surface passes: AI chat
 * (`app/ai-chat/thread-chat.svelte`), the visitor support widget and the same
 * widget after a handoff to a human (`customer-support/feedback-widget.svelte`),
 * and admin support (`admin/support/thread-chat.svelte`), each in the full and
 * the compact layout.
 *
 * The importing test file declares the module mocks: `svelte` as its client
 * runtime, `esm-env`, the haptic hook, `./ChatAttachments.svelte`,
 * `svelte-sonner` and `#lib/media/process-image.js`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte';
import { toast } from 'svelte-sonner';
import { ConvexClient } from 'convex/browser';
import { api } from '#lib/convex/_generated/api.js';
import { processImage } from '#lib/media/process-image.js';
import type { UploadProfile } from '../../../uploads/profiles.js';
import { ChatCore } from '../../core/chat-core.svelte.ts';
import type { AttachmentUploadResult } from '../../core/file-uploader.js';
import { MAX_MESSAGE_LENGTH, type Attachment } from '../../core/types.js';
import type { AttachmentTransferPayload } from '../attachment-transfer.js';
import { ChatUIContext } from '../chat-context.svelte.ts';
import ChatTestProvider from './ChatTestProvider.svelte';
import ChatInputOptionsHarness from './ChatInputOptionsHarness.svelte';
import en from '../../../../i18n/en.json';

const profile: UploadProfile = {
	extensions: { '.txt': 'text/plain', '.png': 'image/png' },
	maxBytes: 100,
	maxBytesLabel: '100 B',
	maxFiles: 2
};

const surfaces = [
	{ surface: 'AI chat' as const, props: { showFileButton: true, showHandoffButton: false } },
	{
		surface: 'visitor support' as const,
		props: { showCameraButton: true, showFileButton: true, showHandoffButton: true }
	},
	{
		surface: 'human handoff' as const,
		props: {
			showCameraButton: true,
			showFileButton: true,
			showHandoffButton: true,
			isHumanOnly: true
		}
	},
	{ surface: 'admin support' as const, props: { showFileButton: true } }
];
export const layouts = [
	{ layout: 'full', compact: false },
	{ layout: 'compact', compact: true }
];
const cases = surfaces.flatMap((surface) => layouts.map((layout) => ({ ...surface, ...layout })));

type HarnessProps = ComponentProps<typeof ChatInputOptionsHarness>;
type ComposerProps = Omit<HarnessProps, 'context'>;
type Provider = ReturnType<typeof mount> & { setContentProps(next: HarnessProps): void };

/**
 * The chat state of one test file and the composer mounted on it.
 * `setupChatInputOptions` replaces the state before each test.
 */
class ChatInputOptions {
	provider: Provider | null = null;
	client!: ConvexClient;
	core!: ChatCore;
	ctx!: ChatUIContext;
	upload!: ReturnType<
		typeof vi.fn<(payload: AttachmentTransferPayload) => Promise<AttachmentUploadResult>>
	>;
	#currentProps!: HarnessProps;

	mountComposer = async (props: ComposerProps) => {
		this.#currentProps = { context: this.ctx, ...props };
		this.provider = mount(ChatTestProvider<HarnessProps>, {
			target: document.body,
			props: {
				client: this.client,
				content: ChatInputOptionsHarness,
				contentProps: this.#currentProps
			}
		}) as Provider;
		await tick();
	};

	/** Change props without waiting for the update to reach the DOM. */
	setPropsNow = (next: Partial<ComposerProps>) => {
		this.#currentProps = { ...this.#currentProps, ...next };
		this.provider!.setContentProps(this.#currentProps);
	};

	setProps = async (next: Partial<ComposerProps>) => {
		this.setPropsNow(next);
		await tick();
	};
}

export const sized = (size: number, name: string, type = 'text/plain') =>
	new File(['x'.repeat(size)], name, { type });

export function attachment(status: 'success' | 'uploading' | 'error', key = 'kept'): Attachment {
	return {
		type: 'file',
		key,
		name: `${key}.txt`,
		size: 3,
		mimeType: 'text/plain',
		uploadState:
			status === 'success'
				? { status, progress: 100, fileId: `file-${key}` }
				: status === 'error'
					? { status, progress: 0, error: 'network' }
					: { status, progress: 40 }
	};
}

export async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
	await tick();
}

export const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
export const sendButton = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="chat-input-send"]');
const notice = () => document.querySelector<HTMLElement>('[data-testid="chat-input-notice"]');

export async function type(value: string) {
	textarea().value = value;
	textarea().dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

export async function pressEnter() {
	textarea().dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
	);
	await tick();
}

export function pick(files: File[]) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, 'files', { value: files, configurable: true });
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

function paste(files: File[]) {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { items: files.map((file) => ({ kind: 'file', getAsFile: () => file })) }
	});
	textarea().dispatchEvent(event);
}

/** Dispatch a drag event at `target`; it bubbles up to the window like a real one. */
export function drag(
	kind: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
	target: EventTarget,
	{
		files = [],
		types = files.length > 0 ? ['Files'] : ['text/plain']
	}: {
		files?: File[];
		types?: string[];
	} = {}
): Event {
	const event = new Event(kind, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'dataTransfer', { value: { files, items: files, types } });
	target.dispatchEvent(event);
	return event;
}

/** Hand `files` to the composer the way a user would through `entry`. */
function addFiles(entry: 'pick' | 'paste' | 'drop', files: File[]) {
	if (entry === 'pick') pick(files);
	else if (entry === 'paste') paste(files);
	else drag('drop', textarea(), { files });
}

const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

export const dropOverlay = () =>
	[...document.querySelectorAll('[aria-hidden="true"]')].find(
		(element) => element.textContent?.trim() === en.chat.tooltip.attach_files
	);

/** Every control that adds a file in this layout: the paperclip and camera, or the Plus menu. */
export function fileEntryButtons(): HTMLButtonElement[] {
	return [
		`button[aria-label="${en.chat.tooltip.attach_files}"]`,
		`button[aria-label="${en.chat.tooltip.mark_bug}"]`,
		`button[aria-label="${en.chat.tooltip.more_actions}"]`
	].flatMap((selector) => [...document.querySelectorAll<HTMLButtonElement>(selector)]);
}

/**
 * Register the composer hooks of the calling test file and return its state.
 * Call it once at the top level; each test gets a new client, core, context
 * and upload mock, and its mounted composer is removed after it.
 */
export function setupChatInputOptions() {
	const state = new ChatInputOptions();

	beforeEach(() => {
		state.client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
		state.upload = vi.fn(async () => ({ fileId: 'upload-1', url: '/attachments/upload-1' }));
		state.core = new ChatCore({
			threadId: 'thread-options',
			api: { sendMessage: api.aiChat.messages.sendMessage }
		});
		state.ctx = new ChatUIContext(state.core, state.client, { upload: state.upload, profile });
		state.ctx.setDisplayMessages([]);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		Object.defineProperty(URL, 'createObjectURL', {
			value: () => 'blob:https://chat.test/preview',
			configurable: true
		});
		Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
		// jsdom has no matchMedia; the compact placeholder reads reduced motion.
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({
				matches: false,
				addEventListener: () => {},
				removeEventListener: () => {}
			}))
		);
	});

	afterEach(async () => {
		if (state.provider) await unmount(state.provider);
		state.provider = null;
		state.ctx.dispose();
		await state.client.close();
		vi.mocked(processImage).mockReset();
		vi.mocked(toast.error).mockReset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	return state;
}

/**
 * The option tests for `surface` in its full and compact layout, run on the
 * state from `setupChatInputOptions`:
 *
 *     describeChatInputOptions(setupChatInputOptions(), 'AI chat');
 */
export function describeChatInputOptions(
	state: ChatInputOptions,
	surface: (typeof surfaces)[number]['surface']
) {
	describe.each(cases.filter((entry) => entry.surface === surface))(
		'ChatInput options on $surface, $layout layout',
		(entry) => optionsCase(state, entry)
	);
}

function optionsCase(state: ChatInputOptions, { props, compact }: (typeof cases)[number]) {
	const { mountComposer, setProps } = state;
	const base = { ...props, compact };
	const busyBlocks = !props.isHumanOnly;

	it('keeps text-only sending and leaves the new options inert by default', async () => {
		const onSend = vi.fn();
		await mountComposer({ ...base, onSend });

		expect(sendButton()!.disabled).toBe(true);
		await pressEnter();
		await type('Hello');
		await pressEnter();

		expect(onSend).toHaveBeenCalledExactlyOnceWith('Hello');
		expect(textarea().disabled).toBe(false);
		expect(notice()).toBeNull();
		expect(fileEntryButtons().length).toBeGreaterThan(0);
		expect(fileEntryButtons().every((button) => !button.disabled)).toBe(true);
	});

	describe('disabled', () => {
		it('disables the field, sending and every file entry point', async () => {
			const onSend = vi.fn();
			const onEmptySubmit = vi.fn();
			await mountComposer({ ...base, onSend, onEmptySubmit, disabled: true });
			await type('Hello');

			expect(textarea().disabled).toBe(true);
			expect(sendButton()!.disabled).toBe(true);
			expect(fileEntryButtons().length).toBeGreaterThan(0);
			expect(fileEntryButtons().every((button) => button.disabled)).toBe(true);

			await pressEnter();
			sendButton()!.click();
			pick([sized(1, 'picked.txt')]);
			paste([sized(1, 'pasted.txt')]);
			drag('drop', window, { files: [sized(1, 'dropped.txt')] });
			await tick();

			expect(onSend).not.toHaveBeenCalled();
			expect(onEmptySubmit).not.toHaveBeenCalled();
			expect(state.upload).not.toHaveBeenCalled();
			expect(state.ctx.attachments).toEqual([]);
			expect(textarea().value).toBe('Hello');
		});

		it('keeps a suggestion from writing the draft, but not while busy', async () => {
			await mountComposer({
				...base,
				disabled: true,
				suggestions: [{ text: 'Suggested text', label: 'Suggestion' }]
			});
			// Suggestions show on a conversation that has not started yet.
			state.core.isNewConversation = true;
			await tick();
			const chip = () =>
				document.querySelector<HTMLButtonElement>('button[title="Suggested text"]')!;

			expect(chip().disabled).toBe(true);
			chip().click();
			await tick();
			expect(state.ctx.inputValue).toBe('');

			await setProps({ disabled: false });
			chip().click();
			await tick();
			expect(state.ctx.inputValue).toBe('Suggested text');

			state.ctx.setInputValue('');
			state.core.isSending = true;
			await tick();
			chip().click();
			await tick();
			expect(state.ctx.inputValue).toBe('Suggested text');
		});

		it('opens again once the gate is lifted', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, disabled: true });
			await type('Hello');
			await setProps({ disabled: false });

			await pressEnter();

			expect(onSend).toHaveBeenCalledExactlyOnceWith('Hello');
		});
	});

	describe('attachmentsDisabledReason', () => {
		const reason = 'Files are not available in this conversation.';

		it('shows the reason and refuses new files while text still sends', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, attachmentsDisabledReason: reason });

			expect(notice()?.textContent).toContain(reason);
			expect(fileEntryButtons().every((button) => button.disabled)).toBe(true);
			pick([sized(1, 'picked.txt')]);
			paste([sized(1, 'pasted.txt')]);
			drag('drop', window, { files: [sized(1, 'dropped.txt')] });
			drag('drop', textarea(), { files: [sized(1, 'dropped-here.txt')] });
			await tick();
			expect(state.upload).not.toHaveBeenCalled();
			expect(state.ctx.attachments).toEqual([]);

			expect(textarea().disabled).toBe(false);
			await type('Text only');
			await pressEnter();
			expect(onSend).toHaveBeenCalledExactlyOnceWith('Text only');
		});

		it('blocks sending files already selected until they are removed', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, allowAttachmentOnlySend: true });
			state.ctx.addAttachments([attachment('success')]);
			await type('With a file');
			await setProps({ attachmentsDisabledReason: reason });

			expect(sendButton()!.disabled).toBe(true);
			await pressEnter();
			expect(onSend).not.toHaveBeenCalled();

			state.ctx.removeAttachment(0);
			await tick();
			await pressEnter();
			expect(onSend).toHaveBeenCalledExactlyOnceWith('With a file');
		});

		it('sends the selected files once the capability returns', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, attachmentsDisabledReason: reason });
			state.ctx.addAttachments([attachment('success')]);
			await type('With a file');
			expect(sendButton()!.disabled).toBe(true);

			await setProps({ attachmentsDisabledReason: undefined });

			expect(notice()).toBeNull();
			expect(sendButton()!.disabled).toBe(false);
			await pressEnter();
			expect(onSend).toHaveBeenCalledExactlyOnceWith('With a file');
		});
	});

	describe('allowAttachmentOnlySend', () => {
		it('sends selected files without text by click and Enter', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, allowAttachmentOnlySend: true });
			state.ctx.addAttachments([attachment('success', 'first')]);
			await tick();

			expect(sendButton()!.disabled).toBe(false);
			sendButton()!.click();
			await tick();
			expect(onSend).toHaveBeenLastCalledWith('');
			expect(state.ctx.attachments).toEqual([]);

			state.ctx.addAttachments([attachment('success', 'second')]);
			await tick();
			await pressEnter();
			expect(onSend).toHaveBeenCalledTimes(2);
		});

		it('keeps files without text unsendable when the option is off', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend });
			state.ctx.addAttachments([attachment('success')]);
			await tick();

			expect(sendButton()!.disabled).toBe(true);
			await pressEnter();
			expect(onSend).not.toHaveBeenCalled();
		});
	});

	describe('onEmptySubmit', () => {
		it('receives an empty submit by click and Enter instead of a send', async () => {
			const onSend = vi.fn();
			const onEmptySubmit = vi.fn();
			await mountComposer({ ...base, onSend, onEmptySubmit });

			expect(sendButton()!.disabled).toBe(false);
			sendButton()!.click();
			await type('   ');
			await pressEnter();

			expect(onEmptySubmit).toHaveBeenCalledTimes(2);
			expect(onSend).not.toHaveBeenCalled();
		});

		it('sends instead once the composer holds text or files', async () => {
			const onSend = vi.fn();
			const onEmptySubmit = vi.fn();
			await mountComposer({ ...base, onSend, onEmptySubmit, allowAttachmentOnlySend: true });
			await type('Hello');
			await pressEnter();
			state.ctx.addAttachments([attachment('success')]);
			await tick();
			await pressEnter();

			expect(onSend.mock.calls).toEqual([['Hello'], ['']]);
			expect(onEmptySubmit).not.toHaveBeenCalled();
		});

		it.each([
			{ file: 'uploading', status: 'uploading' as const },
			{ file: 'failed', status: 'error' as const }
		])('counts a $file file as content, so nothing submits', async ({ status }) => {
			const onSend = vi.fn();
			const onEmptySubmit = vi.fn();
			await mountComposer({ ...base, onSend, onEmptySubmit, allowAttachmentOnlySend: true });
			state.ctx.addAttachments([attachment(status)]);
			await tick();

			expect(sendButton()!.disabled).toBe(true);
			await pressEnter();
			expect(onEmptySubmit).not.toHaveBeenCalled();
			expect(onSend).not.toHaveBeenCalled();
		});
	});

	describe('Enter and the primary action under each blocking condition', () => {
		type Block = {
			condition: string;
			apply: () => Promise<void> | void;
			/** Whether the condition leaves the composer empty, so an empty submit is the one refused. */
			empty?: boolean;
			/** A human-answered thread is never busy waiting on a model. */
			blocks?: boolean;
		};
		const blocks: Block[] = [
			{ condition: 'disabled', apply: () => setProps({ disabled: true }) },
			{
				condition: 'busy',
				apply: () => {
					state.core.isSending = true;
				},
				blocks: busyBlocks
			},
			{ condition: 'rate limited', apply: () => setProps({ isRateLimited: true }) },
			{ condition: 'uploading', apply: () => state.ctx.addAttachments([attachment('uploading')]) },
			{ condition: 'upload error', apply: () => state.ctx.addAttachments([attachment('error')]) },
			{
				condition: 'message too long',
				apply: () => type('x'.repeat(MAX_MESSAGE_LENGTH + 1))
			},
			{
				condition: 'too many attachments',
				apply: () =>
					state.ctx.addAttachments([
						attachment('success', 'one'),
						attachment('success', 'two'),
						attachment('success', 'three')
					])
			},
			{
				condition: 'attachments unavailable with a file selected',
				apply: async () => {
					state.ctx.addAttachments([attachment('success')]);
					await setProps({ attachmentsDisabledReason: 'No files here.' });
				}
			}
		];

		it.each(blocks)('$condition refuses a text send', async ({ apply, blocks = true }) => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, allowAttachmentOnlySend: true });
			await type('Hello');
			await apply();
			await tick();

			expect(sendButton()!.disabled).toBe(blocks);
			await pressEnter();

			expect(onSend).toHaveBeenCalledTimes(blocks ? 0 : 1);
		});

		it.each(blocks.filter(({ condition }) => condition !== 'message too long'))(
			'$condition refuses an attachment-only send',
			async ({ apply, blocks = true }) => {
				const onSend = vi.fn();
				await mountComposer({ ...base, onSend, allowAttachmentOnlySend: true });
				state.ctx.addAttachments([attachment('success', 'only')]);
				await apply();
				await tick();

				await pressEnter();

				expect(onSend).toHaveBeenCalledTimes(blocks ? 0 : 1);
			}
		);

		it.each(
			blocks.filter(({ condition }) => ['disabled', 'busy', 'rate limited'].includes(condition))
		)('$condition refuses an empty submit', async ({ apply, blocks = true }) => {
			const onEmptySubmit = vi.fn();
			await mountComposer({ ...base, onEmptySubmit });
			await apply();
			await tick();

			await pressEnter();
			sendButton()?.click();
			await tick();

			expect(onEmptySubmit).toHaveBeenCalledTimes(blocks ? 0 : 2);
		});

		it('names the over-limit state in the same notice as the caller', async () => {
			await mountComposer({ ...base, withNotice: true });
			await type('x'.repeat(MAX_MESSAGE_LENGTH + 1));

			const region = notice()!;
			expect(region.getAttribute('role')).toBe('status');
			expect(region.textContent).toContain(
				en.chat.notices.message_too_long.replace('{max}', String(MAX_MESSAGE_LENGTH))
			);
			expect(region.querySelector('[data-testid="caller-notice"]')).not.toBeNull();
		});
	});

	describe('onAttachmentRejected', () => {
		it('receives refused picks, pastes and drops instead of toasts', async () => {
			const onAttachmentRejected = vi.fn();
			await mountComposer({ ...base, onAttachmentRejected });

			pick([sized(1, 'report.pdf', 'application/pdf'), sized(101, 'large.txt')]);
			paste([sized(101, 'pasted.txt')]);
			drag('drop', window, { files: [sized(1, 'dropped.pdf', 'application/pdf')] });
			await tick();
			pick([sized(1, 'one.txt'), sized(1, 'two.txt'), sized(1, 'three.txt')]);
			await tick();

			expect(onAttachmentRejected.mock.calls.map(([rejection]) => rejection)).toEqual([
				{
					filename: 'report.pdf',
					reason: en.chat.error.file_type_not_allowed.replace('{filename}', 'report.pdf')
				},
				{
					filename: 'large.txt',
					reason: `${en.chat.error.file_too_large.replace('{filename}', 'large.txt')}. ${en.chat.error.file_max_size.replace('{maxSize}', '100 B')}`
				},
				{
					filename: 'pasted.txt',
					reason: `${en.chat.error.pasted_file_too_large}. ${en.chat.error.file_max_size.replace('{maxSize}', '100 B')}`
				},
				{
					filename: 'dropped.pdf',
					reason: en.chat.error.file_type_not_allowed.replace('{filename}', 'dropped.pdf')
				},
				{
					filename: 'three.txt',
					reason: en.chat.error.max_attachments.replace('{max}', '2')
				}
			]);
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('receives an image whose preprocessing fails after it was added', async () => {
			const onAttachmentRejected = vi.fn();
			const encoding = Promise.withResolvers<never>();
			vi.mocked(processImage).mockReturnValueOnce(encoding.promise);
			await mountComposer({ ...base, onAttachmentRejected });

			pick([sized(10, 'photo.png', 'image/png')]);
			await vi.waitFor(() => expect(state.ctx.attachments).toHaveLength(1));
			encoding.reject(new Error('Encoder crashed'));

			await vi.waitFor(() =>
				expect(onAttachmentRejected).toHaveBeenCalledExactlyOnceWith({
					filename: 'photo.png',
					reason: en.chat.error.upload_failed.replace('{filename}', 'photo.png')
				})
			);
			expect(state.ctx.attachments).toEqual([]);
			expect(state.upload).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('receives an unsupported pasted file, but nothing while files are unavailable', async () => {
			const onAttachmentRejected = vi.fn();
			await mountComposer({ ...base, onAttachmentRejected });

			paste([sized(1, 'unsupported.pdf', 'application/pdf')]);
			await tick();
			expect(onAttachmentRejected).toHaveBeenCalledExactlyOnceWith({
				filename: 'unsupported.pdf',
				reason: en.chat.error.file_type_not_allowed.replace('{filename}', 'unsupported.pdf')
			});

			await setProps({ attachmentsDisabledReason: 'No files here.' });
			paste([sized(1, 'unsupported.pdf', 'application/pdf'), sized(1, 'notes.txt')]);
			await tick();
			expect(onAttachmentRejected).toHaveBeenCalledOnce();
			expect(state.upload).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('keeps an unsupported pasted file silent without a handler', async () => {
			await mountComposer(base);

			paste([sized(1, 'unsupported.pdf', 'application/pdf')]);
			await tick();

			expect(toast.error).not.toHaveBeenCalled();
			expect(state.upload).not.toHaveBeenCalled();
		});

		it.each(['pick', 'paste', 'drop'] as const)(
			'receives every file of a %s past the cap',
			async (entry) => {
				const onAttachmentRejected = vi.fn();
				await mountComposer({ ...base, onAttachmentRejected });

				addFiles(
					entry,
					['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => sized(1, name))
				);

				await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(2));
				const reason = en.chat.error.max_attachments.replace('{max}', '2');
				expect(onAttachmentRejected.mock.calls).toEqual([
					[{ filename: 'c.txt', reason }],
					[{ filename: 'd.txt', reason }]
				]);
				expect(toast.error).not.toHaveBeenCalled();
			}
		);

		it.each(['pick', 'paste', 'drop'] as const)(
			'keeps one toast for a %s past the cap without a handler',
			async (entry) => {
				await mountComposer(base);

				addFiles(
					entry,
					['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => sized(1, name))
				);

				await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(2));
				expect(vi.mocked(toast.error).mock.calls).toEqual([
					[en.chat.error.max_attachments.replace('{max}', '2')]
				]);
			}
		);

		it('keeps the default toast for a failed preprocessing without a handler', async () => {
			vi.mocked(processImage).mockRejectedValueOnce(new Error('Encoder crashed'));
			await mountComposer(base);

			pick([sized(10, 'photo.png', 'image/png')]);

			await vi.waitFor(() =>
				expect(toast.error).toHaveBeenCalledWith(
					en.chat.error.upload_failed.replace('{filename}', 'photo.png')
				)
			);
		});
	});

	describe('actionsLeft and actionsRight', () => {
		it('lets a snippet without arguments replace the defaults, as before', async () => {
			await mountComposer({ ...base, actions: 'replace' });

			expect(document.querySelector('[data-testid="custom-left"]')).not.toBeNull();
			expect(document.querySelector('[data-testid="custom-right"]')).not.toBeNull();
			expect(sendButton()).toBeNull();
			expect(fileEntryButtons()).toEqual([]);
		});

		it('hands the default actions to a snippet that renders them alongside its own', async () => {
			const onSend = vi.fn();
			await mountComposer({ ...base, onSend, actions: 'wrap' });

			expect(document.querySelector('[data-testid="custom-left"]')).not.toBeNull();
			expect(document.querySelector('[data-testid="custom-right"]')).not.toBeNull();
			expect(fileEntryButtons().length).toBeGreaterThan(0);
			await type('Hello');
			sendButton()!.click();
			await tick();
			expect(onSend).toHaveBeenCalledExactlyOnceWith('Hello');

			pick([sized(1, 'wrapped.txt')]);
			await vi.waitFor(() => expect(state.upload).toHaveBeenCalledOnce());
		});
	});

	describe('dropScope', () => {
		it('captures drops anywhere in the window by default', async () => {
			await mountComposer(base);

			const event = drag('drop', document.body, { files: [sized(1, 'anywhere.txt')] });

			expect(event.defaultPrevented).toBe(true);
			await vi.waitFor(() => expect(state.upload).toHaveBeenCalledOnce());
		});

		it('takes several files dropped on the composer', async () => {
			await mountComposer({ ...base, dropScope: 'composer' });

			const event = drag('drop', textarea(), {
				files: [sized(1, 'first.txt'), sized(2, 'second.txt')]
			});

			expect(event.defaultPrevented).toBe(true);
			await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(2));
			expect(state.upload.mock.calls.map(([payload]) => payload.filename)).toEqual([
				'first.txt',
				'second.txt'
			]);
		});

		it('leaves drags outside the composer, and an adjacent drop target, alone', async () => {
			await mountComposer({ ...base, dropScope: 'composer' });
			const adjacent = document.querySelector<HTMLElement>('[data-testid="adjacent-drop-target"]')!;
			const received: string[] = [];
			adjacent.addEventListener('drop', (event) => {
				const files = (event as DragEvent).dataTransfer?.files ?? [];
				received.push(...Array.from(files, (file) => file.name));
			});
			// Registered after the composer's listeners, so it sees what they left of each event.
			const reachedWindow: Array<{ type: string; defaultPrevented: boolean }> = [];
			const record = (event: Event) =>
				reachedWindow.push({ type: event.type, defaultPrevented: event.defaultPrevented });
			for (const kind of ['dragenter', 'dragover', 'drop'] as const) {
				window.addEventListener(kind, record);
			}

			const files = [sized(1, 'for-the-neighbour.txt')];
			drag('dragenter', adjacent, { files });
			drag('dragover', adjacent, { files });
			drag('drop', adjacent, { files });
			drag('drop', document.body, { files: [sized(1, 'on-the-page.txt')] });
			await tick();
			for (const kind of ['dragenter', 'dragover', 'drop'] as const) {
				window.removeEventListener(kind, record);
			}

			expect(received).toEqual(['for-the-neighbour.txt']);
			expect(reachedWindow).toEqual([
				{ type: 'dragenter', defaultPrevented: false },
				{ type: 'dragover', defaultPrevented: false },
				{ type: 'drop', defaultPrevented: false },
				{ type: 'drop', defaultPrevented: false }
			]);
			expect(dropOverlay()).toBeUndefined();
			expect(state.upload).not.toHaveBeenCalled();
		});

		it('leaves a drag without files to the field', async () => {
			await mountComposer({ ...base, dropScope: 'composer' });

			const events = [
				drag('dragenter', textarea(), { types: ['text/plain'] }),
				drag('dragover', textarea(), { types: ['text/plain'] }),
				drag('drop', textarea(), { types: ['text/plain'] })
			];
			await tick();

			expect(events.map((event) => event.defaultPrevented)).toEqual([false, false, false]);
			expect(dropOverlay()).toBeUndefined();
			expect(state.upload).not.toHaveBeenCalled();
		});

		it.each([
			['window', { disabled: true }],
			['composer', { disabled: true }],
			['window', { attachmentsDisabledReason: 'No files here.' }],
			['composer', { attachmentsDisabledReason: 'No files here.' }]
		] as const)(
			'refuses a dropped file in %s scope with %o, without letting the browser open it',
			async (dropScope, gate) => {
				await mountComposer({ ...base, dropScope, ...gate });
				const files = [sized(1, 'refused.txt')];

				drag('dragenter', textarea(), { files });
				await tick();
				expect(dropOverlay()).toBeUndefined();
				const over = drag('dragover', textarea(), { files });
				const drop = drag('drop', textarea(), { files });
				const text = drag('drop', textarea(), { types: ['text/plain'] });
				await tick();

				// The browser opens a file dropped where nothing cancels it, leaving the page.
				expect([over.defaultPrevented, drop.defaultPrevented]).toEqual([true, true]);
				expect(text.defaultPrevented).toBe(false);
				expect(state.upload).not.toHaveBeenCalled();
				expect(state.ctx.attachments).toEqual([]);
			}
		);

		it.each(['window', 'composer'] as const)(
			'counts nested drag enter and leave in %s scope',
			async (dropScope) => {
				await mountComposer({ ...base, dropScope });
				const nested = sendButton()!;
				const files = [sized(1, 'nested.txt')];

				drag('dragenter', textarea(), { files });
				drag('dragenter', nested, { files });
				drag('dragleave', textarea(), { files });
				await tick();
				if (compact) expect(dropOverlay()).toBeDefined();
				drag('dragleave', nested, { files });
				await tick();
				expect(dropOverlay()).toBeUndefined();

				drag('dragenter', textarea(), { files });
				drag('drop', textarea(), { files });
				await tick();
				expect(dropOverlay()).toBeUndefined();
				await vi.waitFor(() => expect(state.upload).toHaveBeenCalledOnce());
			}
		);
	});

	describe('at the attachment cap', () => {
		const maxFiles = 6;
		const limitHint = en.chat.tooltip.attachment_limit.replace('{max}', String(maxFiles));
		const capReason = en.chat.error.max_attachments.replace('{max}', String(maxFiles));
		const files = (count: number, prefix = 'sent') =>
			Array.from({ length: count }, (_, index) => attachment('success', `${prefix}-${index}`));
		const names = (items: Attachment[] = state.ctx.attachments) =>
			items.map((item) => ('name' in item ? item.name : undefined));

		beforeEach(() => {
			state.ctx.dispose();
			state.ctx = new ChatUIContext(state.core, state.client, {
				upload: state.upload,
				profile: { ...profile, maxFiles }
			});
			state.ctx.setDisplayMessages([]);
		});

		/** Mount a composer and send `count` files whose transport answers only when told. */
		async function sendPending(count: number, props: ComposerProps = {}) {
			const transport = Promise.withResolvers<void>();
			const onSend = vi.fn(() => transport.promise);
			await mountComposer({ ...base, onSend, ...props });
			state.ctx.addAttachments(files(count));
			await type(`${count} files`);
			await pressEnter();
			expect(onSend).toHaveBeenCalledOnce();
			expect(state.ctx.attachments).toEqual([]);
			return { onSend, transport };
		}

		/** Hover or focus `button` and expect its tooltip to read `hint`, or no tooltip at all. */
		async function expectHint(
			button: HTMLButtonElement,
			via: 'hover' | 'focus',
			hint: string | undefined
		) {
			if (via === 'hover') {
				// A real hover moves too, which opens the tooltip even right after another one closed.
				button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
				button.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse' }));
			} else {
				button.focus();
			}
			await settle();
			if (hint === undefined) expect(tooltip()).toBeNull();
			else await vi.waitFor(() => expect(tooltip()?.textContent?.trim()).toBe(hint));
			if (via === 'hover') {
				button.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
			} else {
				button.blur();
			}
			await vi.waitFor(() => expect(tooltip()).toBeNull());
		}

		/** Every file entry point looks disabled, names the limit, and does nothing. */
		async function expectEntryPointsHeld(onScreenshot?: ReturnType<typeof vi.fn>) {
			const buttons = fileEntryButtons();
			expect(buttons.length).toBeGreaterThan(0);
			const openPicker = vi.spyOn(HTMLInputElement.prototype, 'click');
			for (const button of buttons) {
				expect(button.disabled).toBe(false);
				expect(button.getAttribute('aria-disabled')).toBe('true');
				await expectHint(button, 'hover', limitHint);
				await expectHint(button, 'focus', limitHint);
				button.click();
				await settle();
			}
			expect(openPicker).not.toHaveBeenCalled();
			expect(onScreenshot ?? vi.fn()).not.toHaveBeenCalled();
			expect(document.querySelector('[role="menu"]')).toBeNull();
			openPicker.mockRestore();
		}

		async function expectEntryPointsOpen() {
			const buttons = fileEntryButtons();
			expect(buttons.length).toBeGreaterThan(0);
			for (const button of buttons) {
				expect(button.disabled).toBe(false);
				expect(button.hasAttribute('aria-disabled')).toBe(false);
				const label = button.getAttribute('aria-label')!;
				// The compact Plus menu had no tooltip before the cap, and has none again.
				await expectHint(
					button,
					'hover',
					label === en.chat.tooltip.more_actions ? undefined : label
				);
			}
		}

		it('holds every entry point while a full send is pending, until it is accepted', async () => {
			const onScreenshot = vi.fn();
			const { transport } = await sendPending(maxFiles, { onScreenshot });

			await expectEntryPointsHeld(onScreenshot);

			transport.resolve();
			await settle();
			await expectEntryPointsOpen();
			const openPicker = vi.spyOn(HTMLInputElement.prototype, 'click');
			fileEntryButtons()[0]!.click();
			await settle();
			if (compact) {
				expect(document.querySelector('[role="menu"]')).not.toBeNull();
			} else {
				expect(openPicker).toHaveBeenCalledOnce();
			}
		});

		it('refuses a paste and a drop with the limit, and keeps the drop from the browser', async () => {
			await sendPending(maxFiles);

			paste([sized(1, 'pasted.txt')]);
			drag('dragenter', textarea(), { files: [sized(1, 'dropped.txt')] });
			await tick();
			expect(dropOverlay()).toBeUndefined();
			const over = drag('dragover', textarea(), { files: [sized(1, 'dropped.txt')] });
			const drop = drag('drop', textarea(), { files: [sized(1, 'dropped.txt')] });
			await settle();

			expect([over.defaultPrevented, drop.defaultPrevented]).toEqual([true, true]);
			expect(vi.mocked(toast.error).mock.calls).toEqual([[capReason], [capReason]]);
			expect(state.upload).not.toHaveBeenCalled();
			expect(state.ctx.attachments).toEqual([]);
		});

		it('hands paste and drop refusals to onAttachmentRejected when set', async () => {
			const onAttachmentRejected = vi.fn();
			await sendPending(maxFiles, { onAttachmentRejected, dropScope: 'composer' });

			paste([sized(1, 'pasted.txt')]);
			const drop = drag('drop', textarea(), { files: [sized(1, 'dropped.txt')] });
			await settle();

			expect(drop.defaultPrevented).toBe(true);
			expect(onAttachmentRejected.mock.calls).toEqual([
				[{ filename: 'pasted.txt', reason: capReason }],
				[{ filename: 'dropped.txt', reason: capReason }]
			]);
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('gives a refused full send back whole, without a notice, and sends it again', async () => {
			const { onSend, transport } = await sendPending(maxFiles);

			transport.reject(new Error('refused'));
			await settle();

			expect(names()).toEqual(names(files(maxFiles)));
			expect(notice()).toBeNull();
			await expectEntryPointsHeld();
			expect(sendButton()!.disabled).toBe(false);
			await pressEnter();
			expect(onSend).toHaveBeenCalledTimes(2);
		});

		it('leaves room only for what a pending send does not hold, and restores never past it', async () => {
			const { transport } = await sendPending(4);
			await expectEntryPointsOpen();

			pick([sized(1, 'new-0.txt'), sized(1, 'new-1.txt'), sized(1, 'new-2.txt')]);
			await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(2));
			expect(vi.mocked(toast.error).mock.calls).toEqual([[capReason]]);
			await expectEntryPointsHeld();

			transport.reject(new Error('refused'));
			await settle();

			expect(names()).toEqual([...names(files(4)), 'new-0.txt', 'new-1.txt']);
			expect(notice()).toBeNull();
		});

		it('frees the slots of an accepted send while an overlapping send is still open', async () => {
			const transports = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
			const onSend = vi.fn(() => transports[onSend.mock.calls.length - 1]!.promise);
			await mountComposer({ ...base, onSend });
			for (const prefix of ['first', 'second']) {
				state.ctx.addAttachments(files(maxFiles / 2, prefix));
				await type(prefix);
				await pressEnter();
			}
			expect(onSend).toHaveBeenCalledTimes(2);
			await expectEntryPointsHeld();

			transports[0]!.resolve();
			await settle();

			await expectEntryPointsOpen();
			pick([sized(1, 'new-0.txt'), sized(1, 'new-1.txt'), sized(1, 'new-2.txt')]);
			await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(3));
			await expectEntryPointsHeld();
		});

		it('holds the entry points for a composer that is full on its own', async () => {
			const onScreenshot = vi.fn();
			await mountComposer({ ...base, onScreenshot });
			state.ctx.addAttachments(files(maxFiles, 'local'));
			await tick();

			await expectEntryPointsHeld(onScreenshot);

			state.ctx.removeAttachment(0);
			await tick();
			await expectEntryPointsOpen();
		});

		it.each([
			{ gate: 'disabled', props: { disabled: true } },
			{ gate: 'attachments unavailable', props: { attachmentsDisabledReason: 'No files here.' } }
		])('lets $gate take precedence over the cap', async ({ props: gate }) => {
			await sendPending(maxFiles);
			await setProps(gate);

			for (const button of fileEntryButtons()) {
				expect(button.disabled).toBe(true);
				expect(button.hasAttribute('aria-disabled')).toBe(false);
			}
		});
	});
}
