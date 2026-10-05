/**
 * One upload policy per surface: the picker, paste, drop, the attachment count
 * and the check on the preprocessed image all read the profile the surface
 * configured, and the image ceiling holds for the exact bytes uploaded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { toast } from 'svelte-sonner';
import { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { processImage } from '$lib/media/process-image';
import type { UploadProfile } from '../../uploads/profiles.js';
import { ChatCore } from '../core/chat-core.svelte.ts';
import type { AttachmentUploadResult } from '../core/file-uploader.js';
import type { AttachmentTransferPayload } from './attachment-transfer.js';
import { ChatUIContext } from './chat-context.svelte.ts';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatInputHarness from './test-fixtures/ChatInputHarness.svelte';
import en from '../../../i18n/en.json';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('./ChatAttachments.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$lib/media/process-image', () => ({ processImage: vi.fn() }));

/** Storage takes 100 bytes, but whatever reads images takes only 40. */
const profile: UploadProfile = {
	extensions: {
		'.txt': 'text/plain',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.webp': 'image/webp'
	},
	maxBytes: 100,
	maxBytesLabel: '100 B',
	maxFiles: 2,
	maxImageBytes: 40,
	maxImageBytesLabel: '40 B'
};

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
let ctx: ChatUIContext;
let upload: ReturnType<
	typeof vi.fn<(payload: AttachmentTransferPayload) => Promise<AttachmentUploadResult>>
>;

const sized = (size: number, name: string, type: string) =>
	new File(['x'.repeat(size)], name, { type });

const uploadedPayloads = () => upload.mock.calls.map(([payload]) => payload);

async function mountComposer() {
	const contentProps = { context: ctx, showFileButton: true };
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: ChatInputHarness, contentProps }
	});
	await tick();
}

function pick(files: File[]) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, 'files', { value: files, configurable: true });
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

function paste(files: File[]) {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { items: files.map((file) => ({ kind: 'file', getAsFile: () => file })) }
	});
	document.querySelector('textarea')!.dispatchEvent(event);
}

function drop(files: File[]) {
	const event = new Event('drop', { cancelable: true });
	Object.defineProperty(event, 'dataTransfer', {
		value: { files, items: files, types: ['Files'] }
	});
	window.dispatchEvent(event);
}

/** processImage for one call: an encoded result, or the input unchanged. */
function encodeTo(size: number | 'passthrough') {
	vi.mocked(processImage).mockImplementationOnce(async (input) => {
		const source = input as Blob;
		if (size === 'passthrough') {
			return { blob: source, mimeType: source.type, width: 4, height: 4, passthrough: true };
		}
		return {
			blob: new Blob(['w'.repeat(size)], { type: 'image/webp' }),
			mimeType: 'image/webp',
			width: 4,
			height: 4,
			passthrough: false
		};
	});
}

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
	upload = vi.fn(async () => ({ fileId: 'upload-1', url: '/attachments/upload-1' }));
	const core = new ChatCore({
		threadId: 'thread-policy',
		api: { sendMessage: api.aiChat.messages.sendMessage }
	});
	ctx = new ChatUIContext(core, client, { upload, profile });
	ctx.setDisplayMessages([]);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	Object.defineProperty(URL, 'createObjectURL', {
		value: () => 'blob:https://chat.test/preview',
		configurable: true
	});
	Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
	// jsdom never loads images, so an original uploaded without encoded
	// dimensions would wait forever for its measurement.
	vi.stubGlobal(
		'Image',
		class {
			naturalWidth = 4;
			naturalHeight = 4;
			onload: (() => void) | null = null;
			set src(_url: string) {
				queueMicrotask(() => this.onload?.());
			}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	ctx.dispose();
	await client.close();
	vi.mocked(processImage).mockReset();
	vi.mocked(toast.error).mockReset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('ChatInput upload policy', () => {
	it('offers the picker exactly the types the profile accepts', async () => {
		await mountComposer();

		expect(document.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe(
			'.txt,.png,.gif,.webp'
		);
		expect(ctx.maxAttachments).toBe(2);
	});

	it('refuses a type outside the profile from the picker, paste and drop alike', async () => {
		await mountComposer();
		const pdf = sized(10, 'report.pdf', 'application/pdf');

		pick([pdf]);
		paste([pdf]);
		drop([pdf]);
		await tick();

		expect(upload).not.toHaveBeenCalled();
		expect(ctx.attachments).toEqual([]);
		expect(toast.error).toHaveBeenCalledTimes(2);
		expect(toast.error).toHaveBeenCalledWith(
			en.chat.error.file_type_not_allowed.replace('{filename}', 'report.pdf')
		);
	});

	it('infers a generic MIME type from the profile extensions', async () => {
		await mountComposer();

		pick([sized(5, 'notes.txt', '')]);

		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		expect(uploadedPayloads()[0]?.mimeType).toBe('text/plain');
	});

	it('accepts a file at maxBytes and refuses one byte more', async () => {
		await mountComposer();

		pick([sized(100, 'fits.txt', 'text/plain'), sized(101, 'over.txt', 'text/plain')]);

		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		expect(uploadedPayloads()[0]?.filename).toBe('fits.txt');
		expect(toast.error).toHaveBeenCalledWith(
			en.chat.error.file_too_large.replace('{filename}', 'over.txt'),
			{ description: en.chat.error.file_max_size.replace('{maxSize}', '100 B') }
		);
	});

	it('counts picked, pasted and dropped files against one maxFiles', async () => {
		await mountComposer();

		pick([sized(1, 'one.txt', 'text/plain')]);
		paste([sized(2, 'two.txt', 'text/plain')]);
		drop([sized(3, 'three.txt', 'text/plain')]);
		await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

		expect(uploadedPayloads().map((payload) => payload.filename)).toEqual(['one.txt', 'two.txt']);
		expect(toast.error).toHaveBeenCalledWith(en.chat.error.max_attachments.replace('{max}', '2'));
	});

	it.each([
		{
			name: 'an encoded image at the image limit',
			source: 90,
			encoded: 40,
			uploaded: { size: 40, filename: 'photo.webp', mimeType: 'image/webp' }
		},
		{
			name: 'the original when only the encoded image is over the limit',
			source: 40,
			encoded: 41,
			uploaded: { size: 40, filename: 'photo.png', mimeType: 'image/png' }
		}
	])('uploads $name', async ({ source, encoded, uploaded }) => {
		await mountComposer();
		encodeTo(encoded);

		pick([sized(source, 'photo.png', 'image/png')]);

		await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
		const [payload] = uploadedPayloads();
		expect({
			size: payload!.blob.size,
			filename: payload!.filename,
			mimeType: payload!.mimeType
		}).toEqual(uploaded);
	});

	it('refuses an image whose encoded and original bytes both exceed the image limit', async () => {
		await mountComposer();
		const attach = vi.spyOn(ctx, 'uploadFile');
		encodeTo(41);
		// Fits storage, so only the stricter image limit can refuse it.
		const photo = sized(41, 'photo.png', 'image/png');

		pick([photo]);

		await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(upload).not.toHaveBeenCalled();
		expect(ctx.attachments).toEqual([]);
		encodeTo(41);
		const preprocess = attach.mock.calls[0]?.[2]?.preprocess;
		await expect(preprocess!(photo)).rejects.toThrow(
			en.chat.error.image_compression_exceeded.replace('{maxSize}', '40 B')
		);
	});

	it.each([
		{ size: 40, uploads: true },
		{ size: 41, uploads: false }
	])(
		'applies the image limit to a $size byte GIF passed through unchanged',
		async ({ size, uploads }) => {
			await mountComposer();
			encodeTo('passthrough');

			pick([sized(size, 'loop.gif', 'image/gif')]);

			if (uploads) {
				await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
				expect(uploadedPayloads()[0]).toMatchObject({
					filename: 'loop.gif',
					mimeType: 'image/gif'
				});
			} else {
				await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
				expect(upload).not.toHaveBeenCalled();
			}
		}
	);
});
