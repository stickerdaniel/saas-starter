import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';
import ChatAttachments from './ChatAttachments.svelte';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
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
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
});

async function renderAttachments(contentProps: ChatAttachmentsProps) {
	component = mount(ChatTestProvider<ChatAttachmentsProps>, {
		target: document.body,
		props: { client, content: ChatAttachments, contentProps }
	});
	await tick();
	return [...document.querySelectorAll<HTMLElement>('[data-testid="attachment-chip"]')];
}

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
		const sent = (filename: string): Attachment => ({
			type: 'remote-file',
			url: `https://cdn.test/${filename}`,
			filename,
			contentType: 'application/pdf'
		});

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
