/**
 * What a failed upload leaves in the console. The rejection's message and cause
 * carry the storage or Convex response, which can quote the file or the user.
 */

import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { createChatSession } from '../__tests__/session-fixture';
import type * as FileUploader from '../core/file-uploader.js';
import { UploadError, type UploadErrorCode } from '../../uploads/transfer.js';

const uploadFileWithProgress = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', async (importOriginal) => ({
	...(await importOriginal<typeof FileUploader>()),
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args)
}));

const { ChatUIContext } = await import('./chat-context.svelte.ts');
const { ChatComposer } = await import('./chat-composer.svelte.ts');

// Made-up backend text.
const SENTINEL = 'upload-sentinel: quarterly-plan for private@sentinel.example';

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: MockInstance[] = [];

function consoleLines(): string[] {
	return consoleSpies
		.flatMap((spy) => spy.mock.calls)
		.map((args) =>
			args
				.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: Infinity })))
				.join(' ')
		);
}

const contexts: Array<InstanceType<typeof ChatUIContext>> = [];

async function failedUpload(error: unknown) {
	uploadFileWithProgress.mockRejectedValueOnce(error);
	const context = new ChatUIContext(
		createChatSession('thread-a'),
		{} as ConvexClient,
		new ChatComposer(),
		{ purpose: 'support' }
	);
	contexts.push(context);
	await context.uploadScreenshot(new Blob(['x'], { type: 'image/png' }), 'shot.png');
	return context;
}

describe('ComposerAttachmentCoordinator upload failure diagnostics', () => {
	beforeEach(() => {
		uploadFileWithProgress.mockReset();
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/attachment');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		consoleSpies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
	});

	afterEach(() => {
		for (const context of contexts.splice(0)) context.dispose();
		vi.restoreAllMocks();
	});

	it('logs the code and status of a rejected transfer, not its cause', async () => {
		const context = await failedUpload(
			new UploadError('http', 413, { cause: new Error(`storage said ${SENTINEL}`) })
		);

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(
			/^\[ComposerAttachmentCoordinator\] Upload failed diagnostic=[0-9a-f]{16} status=413 code=http$/
		);
		expect(lines.join('\n')).not.toContain('sentinel');
		expect(context.attachments[0]).toMatchObject({
			uploadState: { status: 'error', error: 'http' }
		});
	});

	it('logs a failed registration without the Convex message', async () => {
		await failedUpload(
			new UploadError('server', undefined, { cause: new Error(`ConvexError: ${SENTINEL}`) })
		);

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ code=server$/);
		expect(lines.join('\n')).not.toContain('sentinel');
	});

	it('logs an unexpected rejection without its message', async () => {
		const context = await failedUpload(new Error(SENTINEL));

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ code=unclassified$/);
		expect(lines.join('\n')).not.toContain('sentinel');
		expect(context.attachments[0]).toMatchObject({
			uploadState: { status: 'error', error: 'server' }
		});
	});

	it('logs a code no upload transport defines as unclassified', async () => {
		// A custom upload function can build an UploadError from a provider field.
		const code = 'quarterly-plan-private.pdf' as UploadErrorCode;
		await failedUpload(new UploadError(code, 413));

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ status=413 code=unclassified$/);
		expect(lines.join('\n')).not.toContain('quarterly-plan');
	});

	it('stays silent when the upload is canceled', async () => {
		await failedUpload(new DOMException('aborted', 'AbortError'));

		expect(consoleLines()).toEqual([]);
	});
});
