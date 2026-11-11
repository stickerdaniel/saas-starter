import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as SvelteReactivity from 'svelte/reactivity';
import { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';
import ChatAttachments from './ChatAttachments.svelte';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ComposerAttachmentsHarness from './test-fixtures/ComposerAttachmentsHarness.svelte';
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
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
// Only an opened preview dialog renders the text preview; its stylesheet imports are out of scope.
vi.mock('./AttachmentTextPreview.svelte', () => ({ default: () => {} }));

type ChatAttachmentsProps = {
	attachments: Attachment[];
	onRemove?: (index: number) => void;
	onRetry?: (index: number) => void;
	readonly?: boolean;
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	// jsdom has no ResizeObserver; the preview dialog title measures overflow.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	await client.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	flushSync();
}

async function renderAttachments(contentProps: ChatAttachmentsProps) {
	component = mount(ChatTestProvider<ChatAttachmentsProps>, {
		target: document.body,
		props: { client, content: ChatAttachments, contentProps }
	});
	await settle();
	return [...document.querySelectorAll<HTMLElement>('[data-testid="attachment-chip"]')];
}

const sent = (filename: string, contentType = 'application/pdf'): Attachment => ({
	type: 'remote-file',
	url: `https://cdn.test/${filename}`,
	filename,
	contentType
});

const failedUpload = (key: string, name: string): Attachment => ({
	type: 'file',
	key,
	name,
	size: 100,
	mimeType: 'text/plain',
	uploadState: { status: 'error', progress: 0, error: 'network' }
});

/** Buttons whose accessible name is the given translation for a file. */
function buttonsLabelled(template: string, filename: string) {
	const name = template.replace('{filename}', filename);
	return [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
		(button) => button.getAttribute('aria-label') === name
	);
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('ChatAttachments', () => {
	// Two images picked as photo.jpg and photo.jpeg pass dedup, then preprocessing
	// renames both to photo.webp at the same encoded size.
	it('keeps colliding transformed uploads independently removable and retryable', async () => {
		const onRemove = vi.fn();
		const onRetry = vi.fn();

		const chips = await renderAttachments({
			attachments: [failedUpload('upload-a', 'photo.webp'), failedUpload('upload-b', 'photo.webp')],
			onRemove,
			onRetry
		});

		expect(chips).toHaveLength(2);
		const remove = buttonsLabelled(en.chat.aria.remove_attachment, 'photo.webp');
		const retry = buttonsLabelled(en.chat.aria.retry_attachment, 'photo.webp');
		expect(remove).toHaveLength(2);
		expect(retry).toHaveLength(2);

		remove[1]!.click();
		expect(onRemove).toHaveBeenCalledExactlyOnceWith(1);
		expect(onRetry).not.toHaveBeenCalled();

		retry[1]!.click();
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(1);
		expect(onRemove).toHaveBeenCalledOnce();
	});

	// The composer focuses its text field on any click that reaches it, which
	// raises the keyboard on a phone.
	it('leaves the composer text field unfocused after remove and retry', async () => {
		component = mount(ChatTestProvider<ChatAttachmentsProps>, {
			target: document.body,
			props: {
				client,
				content: ComposerAttachmentsHarness,
				contentProps: {
					attachments: [failedUpload('upload-a', 'notes.txt')],
					onRemove: vi.fn(),
					onRetry: vi.fn()
				}
			}
		});
		await settle();
		const textarea = document.querySelector('textarea');
		expect(textarea).not.toBeNull();

		buttonsLabelled(en.chat.aria.retry_attachment, 'notes.txt')[0]!.click();
		buttonsLabelled(en.chat.aria.remove_attachment, 'notes.txt')[0]!.click();

		expect(document.activeElement).not.toBe(textarea);
	});

	it('names the failure cause and offers retry through its own action', async () => {
		const chips = await renderAttachments({
			attachments: [failedUpload('upload-a', 'notes.txt')],
			onRetry: vi.fn()
		});

		expect(chips[0]!.hasAttribute('data-upload-failed')).toBe(true);
		expect(chips[0]!.textContent).toContain(en.chat.error.upload_network);
		expect(chips[0]!.textContent).not.toContain(en.chat.error.upload_readd_hint);
		expect(buttonsLabelled(en.chat.aria.retry_attachment, 'notes.txt')).toHaveLength(1);
	});

	it('tells the user to add the file again when nothing can retry it', async () => {
		const chips = await renderAttachments({
			attachments: [failedUpload('upload-a', 'notes.txt')]
		});

		expect(chips[0]!.textContent).toContain(
			`${en.chat.error.upload_network} ${en.chat.error.upload_readd_hint}`
		);
		expect(buttonsLabelled(en.chat.aria.retry_attachment, 'notes.txt')).toHaveLength(0);
		expect(buttonsLabelled(en.chat.aria.remove_attachment, 'notes.txt')).toHaveLength(1);
	});

	it('shows the upload percentage while a file uploads', async () => {
		const chips = await renderAttachments({
			attachments: [
				{
					type: 'file',
					key: 'upload-a',
					name: 'report.pdf',
					size: 100,
					mimeType: 'application/pdf',
					uploadState: { status: 'uploading', progress: 41.6 }
				}
			]
		});

		expect(chips[0]!.textContent).toContain(
			en.chat.attachment.uploading.replace('{progress}', '42')
		);
		expect(buttonsLabelled(en.chat.aria.preview_attachment, 'report.pdf')).toHaveLength(0);
	});

	it('opens the preview from a sent attachment', async () => {
		await renderAttachments({
			attachments: [sent('first.pdf'), sent('photo.png', 'image/png')],
			readonly: true
		});

		expect(document.querySelectorAll('button')).toHaveLength(2);
		expect(dialog()).toBeNull();

		buttonsLabelled(en.chat.aria.preview_attachment, 'photo.png')[0]!.click();
		await settle();

		expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/photo.png');
		expect(dialog()?.textContent).toContain('photo.png');
	});

	// A failed image keeps its local preview, which would suggest the file exists somewhere.
	it('offers no preview for a failed upload', async () => {
		await renderAttachments({
			attachments: [
				{
					type: 'file',
					key: 'upload-a',
					name: 'photo.png',
					size: 100,
					mimeType: 'image/png',
					preview: 'blob:photo',
					uploadState: { status: 'error', progress: 0, error: 'server' }
				}
			],
			onRetry: vi.fn()
		});

		expect(buttonsLabelled(en.chat.aria.preview_attachment, 'photo.png')).toHaveLength(0);
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
});
