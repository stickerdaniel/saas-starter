import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as SvelteReactivity from 'svelte/reactivity';
import { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';
import ChatAttachments from './ChatAttachments.svelte';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
// Same for svelte/reactivity, whose server entry is a plain, non-reactive Set.
vi.mock('svelte/reactivity', () =>
	vi.importActual<typeof SvelteReactivity>(
		'../../../../node_modules/svelte/src/reactivity/index-client.js'
	)
);
// A duplicate list key throws in every mode; development mode adds the key and index detail.
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
// Only an opened preview dialog renders the text preview; its stylesheet imports are out of scope.
vi.mock('./AttachmentTextPreview.svelte', () => ({ default: () => {} }));

type ChatAttachmentsProps = {
	attachments: Attachment[];
	onRemove?: (index: number) => void;
	onRetry?: (index: number) => void;
	readonly?: boolean;
	meta?: (attachment: Attachment, originalIndex: number) => string | undefined;
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	// jsdom has no ResizeObserver; tiles measure their lines for overflow tooltips.
	// Like the browser's, it reports every newly observed element once.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			#callback: ResizeObserverCallback;
			#connected = true;
			constructor(callback: ResizeObserverCallback) {
				this.#callback = callback;
			}
			observe() {
				queueMicrotask(() => {
					if (this.#connected) this.#callback([], this as unknown as ResizeObserver);
				});
			}
			unobserve() {}
			disconnect() {
				this.#connected = false;
			}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function renderAttachments(contentProps: ChatAttachmentsProps) {
	component = mount(ChatTestProvider<ChatAttachmentsProps>, {
		target: document.body,
		props: { client, content: ChatAttachments, contentProps }
	});
	await tick();
	return [...document.querySelectorAll<HTMLElement>('[data-testid="attachment-chip"]')];
}

const sent = (filename: string): Attachment => ({
	type: 'remote-file',
	url: `https://cdn.test/${filename}`,
	filename,
	contentType: 'application/pdf'
});

const chipFor = (chips: HTMLElement[], filename: string) =>
	chips.find((chip) => chip.textContent?.includes(filename))!;

function removeButtons(filename: string) {
	const name = en.chat.aria.remove_attachment.replace('{filename}', filename);
	return [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
		(button) => button.getAttribute('aria-label') === name
	);
}

describe('ChatAttachments', () => {
	// Two images picked as photo.jpg and photo.jpeg pass dedup, then preprocessing
	// renames both to photo.webp at the same encoded size.
	it('keeps colliding transformed uploads independently removable and retryable', async () => {
		const failedUpload = (key: string): Attachment => ({
			type: 'file',
			key,
			name: 'photo.webp',
			size: 100,
			mimeType: 'image/webp',
			uploadState: { status: 'error', progress: 0, error: 'network' }
		});
		const onRemove = vi.fn();
		const onRetry = vi.fn();

		const chips = await renderAttachments({
			attachments: [failedUpload('upload-a'), failedUpload('upload-b')],
			onRemove,
			onRetry
		});

		expect(chips).toHaveLength(2);
		for (const chip of chips) {
			expect(chip.getAttribute('role')).toBe('button');
			expect(chip.textContent).toContain(en.chat.error.upload_network);
		}
		const buttons = removeButtons('photo.webp');
		expect(buttons).toHaveLength(2);

		buttons[1]!.click();
		expect(onRemove).toHaveBeenCalledExactlyOnceWith(1);
		expect(onRetry).not.toHaveBeenCalled();

		chips[1]!.click();
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('renders sent attachments that carry no upload id', async () => {
		const chips = await renderAttachments({
			attachments: [sent('first.pdf'), sent('second.pdf')],
			readonly: true
		});

		expect(chips.map((chip) => chip.textContent?.trim()).sort()).toEqual([
			'first.pdf',
			'second.pdf'
		]);
	});

	// Readonly right-aligned tiles render in reverse; meta must still see the
	// index into the attachments it was given.
	it('puts meta on the tile of the original index it was asked about', async () => {
		const attachments = [sent('first.pdf'), sent('second.pdf'), sent('third.pdf')];
		const meta = vi.fn((_attachment: Attachment, index: number) =>
			index === 0 ? '12 pages' : undefined
		);

		const chips = await renderAttachments({ attachments, readonly: true, meta });

		expect(chipFor(chips, 'first.pdf').textContent).toContain('12 pages');
		expect(chipFor(chips, 'second.pdf').textContent?.trim()).toBe('second.pdf');
		expect(chipFor(chips, 'third.pdf').textContent?.trim()).toBe('third.pdf');
		for (const [attachment, index] of meta.mock.calls) {
			expect(attachment).toBe(attachments[index]);
		}
	});

	it('shows the failure line instead of meta on a failed upload', async () => {
		const chips = await renderAttachments({
			attachments: [
				{
					type: 'file',
					key: 'upload-a',
					name: 'notes.txt',
					size: 10,
					mimeType: 'text/plain',
					uploadState: { status: 'error', progress: 0, error: 'network' }
				}
			],
			onRetry: vi.fn(),
			meta: () => 'ready to send'
		});

		expect(chips[0]!.textContent).toContain(en.chat.error.upload_network);
		expect(chips[0]!.textContent).not.toContain('ready to send');
	});

	describe('overflow tooltips', () => {
		// jsdom lays nothing out. Model the one measurement the tiles read: a line
		// needs characters times glyph width and every box is 100px wide.
		beforeEach(() => {
			vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
			vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
				this: HTMLElement
			) {
				return (this.textContent?.length ?? 0) * 8;
			});
		});

		const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
		const line = (chip: HTMLElement, text: string) =>
			[...chip.querySelectorAll<HTMLElement>('span')].find(
				(span) => span.textContent?.trim() === text
			)!;

		async function pointer(element: HTMLElement, type: 'pointerenter' | 'pointerleave') {
			element.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
			flushSync();
			await tick();
			await new Promise((resolve) => setTimeout(resolve, 0));
			flushSync();
		}

		it('reveals only the clipped lines, each tile on its own', async () => {
			const longName = 'quarterly-strategy-very-long-notes.md';
			const failureText = `${en.chat.error.upload_network} ${en.chat.error.upload_retry_hint}`;
			const chips = await renderAttachments({
				attachments: [
					{ type: 'file', key: 'a', name: longName, size: 1, mimeType: 'text/markdown' },
					{
						type: 'file',
						key: 'b',
						name: 'a.md',
						size: 1,
						mimeType: 'text/markdown',
						uploadState: { status: 'error', progress: 0, error: 'network' }
					}
				],
				onRetry: vi.fn()
			});
			const longChip = chipFor(chips, longName);
			const shortChip = chipFor(chips, 'a.md');

			await pointer(line(shortChip, 'a.md'), 'pointerenter');
			expect(tooltip()).toBeNull();
			await pointer(line(shortChip, 'a.md'), 'pointerleave');

			await pointer(line(longChip, longName), 'pointerenter');
			expect(tooltip()?.textContent?.trim()).toBe(longName);
			await pointer(line(longChip, longName), 'pointerleave');
			expect(tooltip()).toBeNull();

			await pointer(line(shortChip, failureText), 'pointerenter');
			expect(tooltip()?.textContent?.trim()).toBe(failureText);
		});

		describe('on keyboard focus', () => {
			const longName = 'quarterly-strategy-very-long-notes.md';
			const failureText = `${en.chat.error.upload_network} ${en.chat.error.upload_retry_hint}`;
			const draftName = 'another-very-long-local-draft-name.txt';
			let onRetry: ReturnType<typeof vi.fn<(index: number) => void>>;

			async function settle() {
				flushSync();
				await tick();
				await new Promise((resolve) => setTimeout(resolve, 0));
				flushSync();
			}

			// A failed upload whose filename and failure line are both clipped, a
			// sent file that opens and fits, and a draft that can do neither.
			async function renderTiles() {
				onRetry = vi.fn();
				const chips = await renderAttachments({
					attachments: [
						{
							type: 'file',
							key: 'failed',
							name: longName,
							size: 1,
							mimeType: 'text/markdown',
							uploadState: { status: 'error', progress: 0, error: 'network' }
						},
						sent('b.pdf'),
						{ type: 'file', key: 'draft', name: draftName, size: 1, mimeType: 'text/plain' }
					],
					onRetry
				});
				await settle();
				return {
					failed: chipFor(chips, longName),
					openable: chipFor(chips, 'b.pdf'),
					draft: chipFor(chips, draftName)
				};
			}

			const tooltips = () => [
				...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')
			];
			const tooltipFor = (text: string) =>
				tooltips().find((tip) => tip.textContent?.trim() === text);
			const dialog = () => document.querySelector('[role="dialog"]');

			// jsdom decides :focus-visible from the key or mouse event before the focus, as browsers do.
			async function tabTo(element: HTMLElement) {
				(document.activeElement ?? document.body).dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
				);
				element.focus();
				await settle();
			}

			async function press(element: HTMLElement, key: string) {
				element.dispatchEvent(
					new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
				);
				await settle();
			}

			it('shows every clipped line, the failure below and the filename above', async () => {
				const { failed } = await renderTiles();

				await tabTo(failed);

				expect(document.activeElement).toBe(failed);
				expect(tooltips()).toHaveLength(2);
				expect(tooltipFor(longName)?.dataset.side).toBe('top');
				expect(tooltipFor(failureText)?.dataset.side).toBe('bottom');
				expect(onRetry).not.toHaveBeenCalled();
			});

			it('hides them on Escape until the tile is focused again', async () => {
				const { failed } = await renderTiles();
				await tabTo(failed);

				await press(failed, 'Escape');

				expect(tooltips()).toHaveLength(0);
				expect(onRetry).not.toHaveBeenCalled();
				expect(dialog()).toBeNull();
				await settle();
				expect(tooltips()).toHaveLength(0);

				failed.blur();
				await settle();
				await tabTo(failed);
				expect(tooltips()).toHaveLength(2);

				failed.blur();
				await settle();
				expect(tooltips()).toHaveLength(0);
			});

			it('shows nothing when a click focuses the tile', async () => {
				const { failed } = await renderTiles();

				failed.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
				failed.focus();
				failed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
				failed.click();
				await settle();

				expect(document.activeElement).toBe(failed);
				expect(onRetry).toHaveBeenCalledOnce();
				expect(tooltips()).toHaveLength(0);
			});

			it('shows nothing for a tile whose lines fit', async () => {
				const { openable } = await renderTiles();

				await tabTo(openable);

				expect(document.activeElement).toBe(openable);
				expect(tooltips()).toHaveLength(0);
			});

			it('keeps Enter and Space acting on the tile', async () => {
				const { failed, openable } = await renderTiles();

				await tabTo(failed);
				await press(failed, 'Enter');
				expect(onRetry).toHaveBeenCalledExactlyOnceWith(0);

				await tabTo(openable);
				await press(openable, ' ');
				expect(dialog()).not.toBeNull();
			});

			it('adds no tab stops', async () => {
				const { failed, draft } = await renderTiles();
				await tabTo(failed);
				expect(tooltips()).toHaveLength(2);

				const tabStops = [
					...document.querySelectorAll<HTMLElement>('[tabindex], button, a[href], input')
				].filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled'));
				const tilesAndRemoveButtons = [
					...document.querySelectorAll<HTMLElement>(
						'[data-testid="attachment-chip"][role="button"], [data-testid="attachment-chip"] button'
					)
				];
				expect(tabStops).toEqual(tilesAndRemoveButtons);
				expect(tilesAndRemoveButtons).not.toContain(draft);
			});
		});
	});
});
