import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type * as Svelte from 'svelte';
import { toast } from 'svelte-sonner';
import { processImage } from '#lib/media/process-image.js';
import {
	attachment,
	drag,
	dropOverlay,
	fileEntryButtons,
	layouts,
	pick,
	pressEnter,
	sendButton,
	settle,
	setupChatInputOptions,
	sized,
	textarea,
	type
} from './test-fixtures/chat-input-options-suite.js';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('#lib/media/process-image.js', () => ({ processImage: vi.fn() }));

const state = setupChatInputOptions();
const { mountComposer, setProps, setPropsNow } = state;

describe('ChatInput attachment menu when a gate closes while it is open', () => {
	const props = { compact: true, showFileButton: true, showCameraButton: true };
	const menu = () => document.querySelector('[role="menu"]');
	const menuItem = (label: string) =>
		[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
			item.textContent?.includes(label)
		)!;

	type Gate = {
		gate: string;
		prepare?: () => Promise<void>;
		close: () => void;
		reopen: () => Promise<void> | void;
	};
	const gates: Gate[] = [
		{
			gate: 'disabled',
			close: () => setPropsNow({ disabled: true }),
			reopen: () => setProps({ disabled: false })
		},
		{
			gate: 'attachments unavailable',
			close: () => setPropsNow({ attachmentsDisabledReason: 'No files here.' }),
			reopen: () => setProps({ attachmentsDisabledReason: undefined })
		},
		{
			gate: 'the cap held by a pending send',
			// Both slots go to a send still waiting on its transport, then the
			// composer shows another conversation, where the slots are free.
			prepare: async () => {
				state.ctx.addAttachments([attachment('success', 'a'), attachment('success', 'b')]);
				await type('Two files');
				await pressEnter();
				expect(state.ctx.attachments).toEqual([]);
				state.core.setThread('another-thread');
				await tick();
			},
			close: () => state.core.setThread('thread-options'),
			reopen: () => state.core.setThread('another-thread')
		}
	];
	const activations = gates.flatMap((gate) =>
		(['attach files', 'screenshot'] as const).flatMap((item) =>
			(['click', 'Enter'] as const).map((via) => ({ ...gate, item, via }))
		)
	);

	it.each(activations)(
		'closes on $gate, and its $item item does nothing on $via',
		async ({ prepare, close, reopen, item, via }) => {
			const onScreenshot = vi.fn();
			const onSend = vi.fn(() => new Promise<void>(() => {}));
			await mountComposer({ ...props, onScreenshot, onSend });
			await prepare?.();
			const openPicker = vi.spyOn(HTMLInputElement.prototype, 'click');
			fileEntryButtons()[0]!.click();
			await settle();
			expect(menu()).not.toBeNull();
			const target = menuItem(
				item === 'screenshot' ? en.chat.tooltip.mark_bug : en.chat.tooltip.attach_files
			);

			close();
			// The item is still on screen until the update lands, as for a
			// choice made in the same moment the gate closes.
			if (via === 'click') target.click();
			else {
				target.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
				);
			}
			await settle();

			expect(menu()).toBeNull();
			expect(openPicker).not.toHaveBeenCalled();
			expect(onScreenshot).not.toHaveBeenCalled();

			// Choosing an item closes the menu anyway, so the gate gets to close it alone.
			await reopen();
			await settle();
			fileEntryButtons()[0]!.click();
			await settle();
			expect(menu()).not.toBeNull();
			close();
			await settle();
			expect(menu()).toBeNull();
			await reopen();
			await settle();
			expect(menu()).toBeNull();

			fileEntryButtons()[0]!.click();
			await settle();
			menuItem(en.chat.tooltip.mark_bug).click();
			await settle();
			expect(onScreenshot).toHaveBeenCalledOnce();
		}
	);
});

describe.each(['window', 'composer'] as const)(
	'ChatInput compact drag in %s scope across a gate',
	(dropScope) => {
		const cases = [
			{ gate: 'disabled', props: { disabled: true } },
			{ gate: 'attachments unavailable', props: { attachmentsDisabledReason: 'No files here.' } }
		].flatMap((gate) => (['drop', 'dragleave'] as const).map((end) => ({ ...gate, end })));

		it.each(cases)(
			'ends a drag refused with a $end under $gate, and takes the next one',
			async ({ props: gate, end }) => {
				await mountComposer({ compact: true, showFileButton: true, dropScope });
				const files = [sized(1, 'drag.txt')];
				drag('dragenter', textarea(), { files });
				await tick();
				expect(dropOverlay()).toBeDefined();

				await setProps(gate);
				const ended = drag(end, textarea(), { files });
				await setProps({ disabled: false, attachmentsDisabledReason: undefined });

				if (end === 'drop') expect(ended.defaultPrevented).toBe(true);
				expect(dropOverlay()).toBeUndefined();
				expect(state.upload).not.toHaveBeenCalled();

				const nested = sendButton()!;
				drag('dragenter', textarea(), { files });
				drag('dragenter', nested, { files });
				drag('dragleave', textarea(), { files });
				await tick();
				expect(dropOverlay()).toBeDefined();
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
	}
);

describe.each(layouts)(
	'ChatInput feedback for a file refused after it was added, $layout layout',
	({ compact }) => {
		const base = { compact, showFileButton: true, showCameraButton: true };
		const failed = en.chat.error.upload_failed.replace('{filename}', 'photo.png');
		const tooLarge = (filename: string) =>
			en.chat.error.file_too_large.replace('{filename}', filename);
		const maxSize = en.chat.error.file_max_size.replace('{maxSize}', '100 B');

		it.each([
			{ change: 'added', before: false, after: true },
			{ change: 'replaced', before: true, after: true },
			{ change: 'removed', before: true, after: false }
		])(
			'tells the handler current at settlement, when one is $change during encoding',
			async ({ before, after }) => {
				const previous = vi.fn();
				const current = vi.fn();
				const encoding = Promise.withResolvers<never>();
				vi.mocked(processImage).mockReturnValueOnce(encoding.promise);
				await mountComposer({ ...base, onAttachmentRejected: before ? previous : undefined });
				pick([sized(10, 'photo.png', 'image/png')]);
				await vi.waitFor(() => expect(state.ctx.attachments).toHaveLength(1));

				await setProps({ onAttachmentRejected: after ? current : undefined });
				encoding.reject(new Error('Encoder crashed'));
				await vi.waitFor(() => expect(state.ctx.attachments).toEqual([]));
				await settle();

				expect(previous).not.toHaveBeenCalled();
				if (after) {
					expect(current).toHaveBeenCalledExactlyOnceWith({
						filename: 'photo.png',
						reason: failed
					});
					expect(toast.error).not.toHaveBeenCalled();
				} else {
					expect(vi.mocked(toast.error).mock.calls).toEqual([[failed]]);
				}
			}
		);

		it('tells the handler about a file the final payload check refuses, with the limit', async () => {
			const onAttachmentRejected = vi.fn();
			// The composer's own checks stop an oversized file before this point;
			// bytes that grew after them are what the final check is there for.
			const uploadFile = state.ctx.uploadFile.bind(state.ctx);
			vi.spyOn(state.ctx, 'uploadFile').mockImplementation((_file, filename, options) =>
				uploadFile(sized(101, 'notes.txt'), filename, options)
			);
			await mountComposer({ ...base, onAttachmentRejected });

			pick([sized(1, 'notes.txt')]);

			await vi.waitFor(() =>
				expect(onAttachmentRejected).toHaveBeenCalledExactlyOnceWith({
					filename: 'notes.txt',
					reason: `${tooLarge('notes.txt')}. ${maxSize}`
				})
			);
			expect(state.upload).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it.each([
			{ owner: 'the handler', withHandler: true },
			{ owner: 'the default toast', withHandler: false }
		])(
			'reports a screenshot from the composer that the final payload check refuses to $owner',
			async ({ withHandler }) => {
				const onAttachmentRejected = vi.fn();
				const onScreenshot = vi.fn(() => {
					const blob = new Blob(['x'.repeat(101)], { type: 'image/png' });
					void state.ctx.uploadScreenshot(blob, 'screenshot.png', { width: 4, height: 4 });
				});
				await mountComposer({
					...base,
					onScreenshot,
					onAttachmentRejected: withHandler ? onAttachmentRejected : undefined
				});

				if (compact) {
					fileEntryButtons()[0]!.click();
					await settle();
					[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
						.find((item) => item.textContent?.includes(en.chat.tooltip.mark_bug))!
						.click();
				} else {
					document
						.querySelector<HTMLButtonElement>(`button[aria-label="${en.chat.tooltip.mark_bug}"]`)!
						.click();
				}
				await settle();
				expect(onScreenshot).toHaveBeenCalledOnce();

				if (withHandler) {
					await vi.waitFor(() =>
						expect(onAttachmentRejected).toHaveBeenCalledExactlyOnceWith({
							filename: 'screenshot.png',
							reason: `${tooLarge('screenshot.png')}. ${maxSize}`
						})
					);
					expect(toast.error).not.toHaveBeenCalled();
				} else {
					await vi.waitFor(() =>
						expect(vi.mocked(toast.error).mock.calls).toEqual([
							[tooLarge('screenshot.png'), { description: maxSize }]
						])
					);
				}
				expect(state.ctx.attachments).toEqual([]);
				expect(state.upload).not.toHaveBeenCalled();
			}
		);
	}
);

describe('ChatInput contentClass', () => {
	it('styles the compact wrapper around the field and its actions', async () => {
		await mountComposer({ showFileButton: true, compact: true, contentClass: 'composer-inset' });

		const wrapper = document.querySelector('.composer-inset')!;
		expect(wrapper.contains(textarea())).toBe(true);
		expect(wrapper.contains(sendButton())).toBe(true);
	});
});
