import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const avatar = readFileSync(
	resolve('src/routes/[[lang]]/app/settings/account-settings.svelte'),
	'utf8'
);
const screenshotEditor = readFileSync(
	resolve('src/lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte'),
	'utf8'
);
const supportSurface = readFileSync(
	resolve('src/lib/components/customer-support/customer-support.svelte'),
	'utf8'
);
const coordinator = readFileSync(
	resolve('src/lib/chat/ui/composer-attachment-coordinator.svelte.ts'),
	'utf8'
);

describe('upload surface abstraction boundary', () => {
	it('keeps screenshot capture outside the shared chat transfer lifecycle', () => {
		expect(screenshotEditor).toContain('const processed = await processImage(canvas);');
		expect(screenshotEditor).toContain(
			'onScreenshotSaved?.(processed.blob, filename, dimensions);'
		);
		expect(supportSurface).toContain(
			'await chatUIContext.uploadScreenshot(blob, filename, dimensions);'
		);
		expect(coordinator).toContain('async uploadScreenshot(');
		expect(coordinator).toContain('const transfer = this.createTransfer(');
		expect(coordinator).toContain('await transfer.start();');
	});

	it('gives profile images only the neutral lower-level upload pieces', () => {
		expect(avatar).toContain("from '$lib/uploads/profile-image.js'");
		expect(avatar).toContain("from '$lib/uploads/transfer.js'");
		expect(avatar).toContain('requestUploadGrant(profileImageUploadAdapter');
		expect(avatar).toContain('uploadGrantedWithAdapter({');
		expect(avatar).not.toContain("from '$lib/chat");
		expect(avatar).not.toContain('ComposerAttachmentCoordinator');
		expect(avatar).not.toContain('attachmentStore');
		expect(avatar).not.toContain('threadId');
		expect(avatar).not.toContain('parked');
	});
});
