import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const context = readFileSync(resolve('src/lib/chat/ui/chat-context.svelte.ts'), 'utf8');
const coordinator = readFileSync(
	resolve('src/lib/chat/ui/composer-attachment-coordinator.svelte.ts'),
	'utf8'
);
const input = readFileSync(resolve('src/lib/chat/ui/ChatInput.svelte'), 'utf8');

describe('ComposerAttachmentCoordinator ownership boundary', () => {
	it('keeps ChatUIContext as a thin attachment facade', () => {
		expect(context).toContain('new ComposerAttachmentCoordinator({');
		expect(context).toContain('return this.attachmentCoordinator.uploadFile(');
		expect(context).toContain('return this.attachmentCoordinator.uploadScreenshot(');
		expect(context).toContain('return this.attachmentCoordinator.attachments;');
		expect(context).not.toContain('new AttachmentTransfer({');
		expect(context).not.toContain('private readonly transfers');
		expect(context).not.toContain('private readonly parked');
		expect(context).not.toContain('private readonly pendingUploads');
		expect(context).not.toContain('attachmentStore?.readThread');
		expect(context).not.toContain('URL.createObjectURL');
	});

	it('locates thread, storage, preview, transfer, and upload-guard ownership together', () => {
		expect(coordinator).toContain('export class ComposerAttachmentCoordinator');
		expect(coordinator).toContain('private readonly transfers');
		expect(coordinator).toContain('readonly maxAttachments = MAX_ATTACHMENTS');
		expect(coordinator).toContain('private readonly parked');
		expect(coordinator).toContain('private readonly pendingUploads');
		expect(coordinator).toContain('registerPersistedChatHolder(this)');
		expect(coordinator).toContain('attachmentStore?.readThread');
		expect(coordinator).toContain('URL.createObjectURL');
		expect(coordinator).toContain('new AttachmentTransfer({');
		expect(coordinator).toContain('this.activeUploads?.claim(this)');
		expect(coordinator).toContain('this.activeUploads?.release(this)');
		expect(input).not.toContain('MAX_ATTACHMENTS');
		expect(input).toContain('if (!ctx.canAddAttachment)');
		expect(input).toContain('{ max: ctx.maxAttachments }');
	});
});
