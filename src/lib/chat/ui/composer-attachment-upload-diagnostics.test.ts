/**
 * What a failed upload leaves in the console. The rejection's message and cause
 * carry the storage or Convex response, which can quote the file or the user.
 */

import { inspect } from 'node:util';
import { api } from '#lib/convex/_generated/api.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type * as FileUploader from '../core/file-uploader.js';
import { UploadError } from '../../uploads/transfer.js';

const uploadFileWithProgress = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../core/file-uploader.js', async (importOriginal) => ({
	...(await importOriginal<typeof FileUploader>()),
	uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args)
}));

const { ComposerAttachmentCoordinator } =
	await import('./composer-attachment-coordinator.svelte.ts');

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

const coordinators: Array<InstanceType<typeof ComposerAttachmentCoordinator>> = [];

async function failedUpload(error: unknown) {
	uploadFileWithProgress.mockRejectedValueOnce(error);
	const coordinator = new ComposerAttachmentCoordinator({
		getThreadId: () => 'thread-a',
		client: {} as ConvexClient,
		uploadConfig: {
			generateUploadUrl: api.support.files.generateUploadUrl,
			saveUploadedFile: api.support.files.saveUploadedFile
		}
	});
	coordinators.push(coordinator);
	await coordinator.uploadScreenshot(new Blob(['x'], { type: 'image/png' }), 'shot.png');
	return coordinator;
}

describe('ComposerAttachmentCoordinator upload failure diagnostics', () => {
	beforeEach(() => {
		uploadFileWithProgress.mockReset();
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/attachment');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		consoleSpies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
	});

	afterEach(() => {
		for (const coordinator of coordinators.splice(0)) coordinator.dispose();
		vi.restoreAllMocks();
	});

	it('logs the code and status of a rejected transfer, not its cause', async () => {
		const coordinator = await failedUpload(
			new UploadError('http', 413, { cause: new Error(`storage said ${SENTINEL}`) })
		);

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(
			/^\[ComposerAttachmentCoordinator\] Upload failed diagnostic=[0-9a-f]{16} status=413 code=http$/
		);
		expect(lines.join('\n')).not.toContain('sentinel');
		expect(coordinator.attachments[0]).toMatchObject({
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
		const coordinator = await failedUpload(new Error(SENTINEL));

		const lines = consoleLines();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/ code=unclassified$/);
		expect(lines.join('\n')).not.toContain('sentinel');
		expect(coordinator.attachments[0]).toMatchObject({
			uploadState: { status: 'error', error: 'server' }
		});
	});

	it('stays silent when the upload is canceled', async () => {
		await failedUpload(new DOMException('aborted', 'AbortError'));

		expect(consoleLines()).toEqual([]);
	});
});
