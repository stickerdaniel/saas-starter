/**
 * Unit tests for ChatUIContext attachment cleanup
 *
 * Covers blob preview URL revocation in removeAttachment, clearAttachments,
 * and dispose so unsent attachment previews do not leak until page unload.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { ChatUIContext } from './chat-context.svelte.js';
import type { ChatCore } from '../core/chat-core.svelte.js';
import type { ConvexClient } from 'convex/browser';
import type { Attachment } from '../core/types.js';

const mockCore = {} as ChatCore;
const mockClient = {} as ConvexClient;

function fileAttachment(preview?: string): Attachment {
	return {
		type: 'file',
		key: crypto.randomUUID(),
		name: 'doc.png',
		size: 1024,
		mimeType: 'image/png',
		preview,
		uploadState: { status: 'success', progress: 100, fileId: 'file-1' }
	};
}

function screenshotAttachment(preview?: string): Attachment {
	return {
		type: 'screenshot',
		key: crypto.randomUUID(),
		name: 'shot.png',
		size: 2048,
		mimeType: 'image/png',
		preview,
		uploadState: { status: 'success', progress: 100, fileId: 'file-2' }
	};
}

describe('ChatUIContext attachment cleanup', () => {
	let revokeSpy: ReturnType<typeof vi.spyOn>;

	beforeAll(() => {
		// jsdom does not implement createObjectURL/revokeObjectURL
		if (!('revokeObjectURL' in URL)) {
			Object.defineProperty(URL, 'revokeObjectURL', {
				value: () => {},
				writable: true,
				configurable: true
			});
		}
	});

	beforeEach(() => {
		revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	});

	afterEach(() => {
		revokeSpy.mockRestore();
	});

	it('revokes the blob preview when removing an attachment', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([fileAttachment('blob:http://localhost/a')]);

		ctx.removeAttachment(0);

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/a');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('revokes all blob previews when clearing attachments', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([
			fileAttachment('blob:http://localhost/a'),
			screenshotAttachment('blob:http://localhost/b')
		]);

		ctx.clearAttachments();

		expect(revokeSpy).toHaveBeenCalledTimes(2);
		expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/a');
		expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/b');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('revokes remaining blob previews on dispose', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([screenshotAttachment('blob:http://localhost/c')]);

		ctx.dispose();

		expect(revokeSpy).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/c');
		expect(ctx.attachments).toHaveLength(0);
	});

	it('skips attachments without a blob preview', () => {
		const ctx = new ChatUIContext(mockCore, mockClient);
		ctx.addAttachments([
			fileAttachment(undefined),
			fileAttachment('https://example.com/not-a-blob.png')
		]);

		ctx.clearAttachments();

		expect(revokeSpy).not.toHaveBeenCalled();
		expect(ctx.attachments).toHaveLength(0);
	});
});
