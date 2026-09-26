import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
