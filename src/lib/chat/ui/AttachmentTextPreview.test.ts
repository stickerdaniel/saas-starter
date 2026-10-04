import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';
import { MAX_PREVIEW_TEXT_CHARS } from '../core/attachmentPreview.js';
import AttachmentTextPreview from './AttachmentTextPreview.svelte';
import ChatAttachments from './ChatAttachments.svelte';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
// These previews are plain text; the Markdown renderers' stylesheet imports are out of scope.
vi.mock('svelte-streamdown', () => ({ Streamdown: () => {} }));
vi.mock('svelte-streamdown/code', () => ({ default: () => {} }));
vi.mock('svelte-streamdown/math', () => ({ default: () => {} }));

type LoadedText = { text: string; truncated: boolean };

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	// jsdom has no ResizeObserver; the tiles and the dialog title measure overflow.
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
	vi.unstubAllGlobals();
});

async function settle() {
	for (let i = 0; i < 5; i++) {
		flushSync();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	flushSync();
}

const previewContent = () =>
	document.querySelector<HTMLElement>('[data-testid="attachment-preview-content"]');
const previewError = () =>
	document.querySelector<HTMLElement>('[data-testid="attachment-preview-error"]');
const truncatedNote = en.chat.attachment.preview_truncated.replace('{size}', '256 KB');

function deferred() {
	let resolve!: (value: LoadedText) => void;
	const promise = new Promise<LoadedText>((done) => (resolve = done));
	return { promise, resolve };
}

describe('ChatAttachments text loader', () => {
	type Props = {
		attachments: Attachment[];
		readonly?: boolean;
		loadText?: (attachment: Attachment) => Promise<LoadedText>;
	};

	const sentNotes: Attachment = {
		type: 'remote-file',
		url: 'https://cdn.test/notes.txt',
		filename: 'notes.txt',
		contentType: 'text/plain'
	};

	async function openPreview(loadText: Props['loadText']) {
		component = mount(ChatTestProvider<Props>, {
			target: document.body,
			props: {
				client,
				content: ChatAttachments,
				contentProps: { attachments: [sentNotes], readonly: true, loadText }
			}
		});
		await settle();
		document.querySelector<HTMLElement>('[data-testid="attachment-chip"]')!.click();
		await settle();
	}

	it('previews the text the loader returns for an attachment without a local blob', async () => {
		const loadText = vi.fn(async (_attachment: Attachment) => ({
			text: 'Loaded by the caller',
			truncated: false
		}));

		await openPreview(loadText);

		expect(loadText).toHaveBeenCalledTimes(1);
		expect(loadText.mock.calls[0]![0]).toBe(sentNotes);
		expect(previewContent()?.textContent).toContain('Loaded by the caller');
	});

	it('shows the error state instead of the raw file when the loader rejects', async () => {
		await openPreview(() => Promise.reject(new Error('denied')));

		expect(previewError()?.textContent?.trim()).toBe(en.chat.attachment.preview_error);
		expect(document.querySelector('iframe')).toBeNull();
	});
});

describe('AttachmentTextPreview', () => {
	type Props = {
		url?: string;
		filename?: string;
		mimeType?: string;
		blob?: Blob | null;
		loadText?: () => Promise<LoadedText>;
	};

	async function renderPreview(props: Props) {
		const provider = mount(ChatTestProvider<Props>, {
			target: document.body,
			props: { client, content: AttachmentTextPreview, contentProps: props }
		});
		component = provider;
		await settle();
		return provider as unknown as { setContentProps(next: Props): void };
	}

	it('reads only the start of a large local file', async () => {
		const head = 'Beginning of the file\n';
		const byteLimit = 4 * MAX_PREVIEW_TEXT_CHARS;
		const encoder = new TextEncoder();
		// The three-byte euro sign starts one byte before the read limit.
		const filler = 'a'.repeat(byteLimit - 1 - encoder.encode(head).length);
		const blob = new Blob([`${head}${filler}€ and the rest`], { type: 'text/plain' });
		expect(encoder.encode(`${head}${filler}`).length).toBe(byteLimit - 1);
		blob.text = () => {
			throw new Error('read the whole file');
		};

		await renderPreview({
			url: 'https://cdn.test/huge.txt',
			filename: 'huge.txt',
			mimeType: 'text/plain',
			blob
		});

		const content = previewContent();
		expect(content?.querySelector('pre')?.textContent?.startsWith(head)).toBe(true);
		expect(content?.querySelector('pre')?.textContent).toHaveLength(MAX_PREVIEW_TEXT_CHARS);
		expect(content?.textContent).toContain(truncatedNote);
	});

	it('previews a small local file whole, multibyte characters included', async () => {
		await renderPreview({
			filename: 'small.txt',
			mimeType: 'text/plain',
			blob: new Blob(['Grüße, 5 €']),
			loadText: () => Promise.reject(new Error('the local file comes first'))
		});

		expect(previewContent()?.querySelector('pre')?.textContent).toBe('Grüße, 5 €');
		expect(previewContent()?.textContent).not.toContain(truncatedNote);
	});

	it('keeps a slow load for a previous file from replacing the current one', async () => {
		const previous = deferred();
		const current = deferred();
		const preview = await renderPreview({
			filename: 'previous.txt',
			mimeType: 'text/plain',
			loadText: () => previous.promise
		});

		preview.setContentProps({
			filename: 'current.txt',
			mimeType: 'text/plain',
			loadText: () => current.promise
		});
		await settle();
		current.resolve({ text: 'current text', truncated: false });
		await settle();
		previous.resolve({ text: 'previous text', truncated: false });
		await settle();

		expect(previewContent()?.textContent).toContain('current text');
		expect(previewContent()?.textContent).not.toContain('previous text');
	});
});
