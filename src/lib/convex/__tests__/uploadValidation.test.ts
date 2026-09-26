// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({ storeFile: vi.fn() }));

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(),
		safeGetAuthUser: vi.fn()
	}
}));

// Upload finalization never resolves an owner; this cuts the agent-tool import chain.
vi.mock('../support/ownership', () => ({ getSupportOwnerIdentity: vi.fn() }));

vi.mock('../_generated/api', () => ({
	components: {
		agent: 'components.agent',
		convexFilesControl: {
			upload: { finalizeUpload: 'files.upload.finalizeUpload' },
			download: {
				createDownloadGrant: 'files.download.createDownloadGrant',
				consumeDownloadGrantForUrl: 'files.download.consumeDownloadGrantForUrl'
			},
			cleanUp: { deleteFile: 'files.cleanUp.deleteFile' }
		}
	},
	internal: {
		aiChat: { files: { requireFileAccess: 'internal.aiChat.files.requireFileAccess' } },
		files: { metadata: { storeFileMetadata: 'internal.files.metadata.storeFileMetadata' } }
	}
}));

import { storeFile } from '@convex-dev/agent';
import { saveUploadedFile as saveSupportFile } from '../support/files';
import { saveUploadedFile as saveAiChatFile } from '../aiChat/files';

type SaveUploadedFileArgs = {
	storageId: string;
	uploadToken: string;
	filename?: string;
	mimeType: string;
};

type SaveUploadedFileHandler = {
	_handler: (
		ctx: unknown,
		args: SaveUploadedFileArgs
	) => Promise<{ fileId: string; isImage: boolean }>;
};

const storeFileMock = storeFile as unknown as ReturnType<typeof vi.fn>;
const DOWNLOAD_URL = 'https://files.test/download/storage-1';

const mutationResults: Record<string, unknown> = {
	'internal.aiChat.files.requireFileAccess': null,
	'files.upload.finalizeUpload': null,
	'files.download.createDownloadGrant': { downloadToken: 'download-token' },
	'files.download.consumeDownloadGrantForUrl': { status: 'ok', downloadUrl: DOWNLOAD_URL },
	'files.cleanUp.deleteFile': null
};

let runMutation: ReturnType<typeof vi.fn>;

function serveDownloadedFile(contentType: string) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			expect(url).toBe(DOWNLOAD_URL);
			return new Response('downloaded bytes', { headers: { 'content-type': contentType } });
		})
	);
}

function saveAsClaimedPng(action: SaveUploadedFileHandler) {
	return action._handler(
		{ runMutation },
		{
			storageId: 'storage-1',
			uploadToken: 'upload-token',
			filename: 'claimed.png',
			mimeType: 'image/png'
		}
	);
}

beforeEach(() => {
	runMutation = vi.fn(async (reference: string) => {
		if (!(reference in mutationResults)) throw new Error(`Unexpected mutation ${reference}`);
		return mutationResults[reference];
	});
	storeFileMock.mockReset();
	storeFileMock.mockResolvedValue({
		file: {
			fileId: 'file-1',
			storageId: 'storage-1',
			url: 'https://files.test/stored',
			filename: 'claimed.png'
		}
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// Each upload surface has its own finalize action. The client MIME claim is
// untrusted, so each must validate the bytes it actually downloaded.
describe.each([
	['support', saveSupportFile as unknown as SaveUploadedFileHandler],
	['aiChat', saveAiChatFile as unknown as SaveUploadedFileHandler]
])('%s saveUploadedFile', (_surface, action) => {
	it('rejects a disallowed downloaded type despite an image claim and deletes the upload', async () => {
		serveDownloadedFile('application/x-msdownload');

		await expect(saveAsClaimedPng(action)).rejects.toMatchObject({
			data: { code: 'FILE_TYPE_NOT_ALLOWED' }
		});

		expect(storeFileMock).not.toHaveBeenCalled();
		expect(runMutation).toHaveBeenCalledWith('files.cleanUp.deleteFile', {
			storageId: 'storage-1'
		});
	});

	// Markdown is offered by the picker but absent from a naive copied allowlist.
	it.each(['text/plain; charset=utf-8', 'text/markdown; charset=utf-8'])(
		'classifies an accepted %s upload by its downloaded type',
		async (contentType) => {
			serveDownloadedFile(contentType);

			await expect(saveAsClaimedPng(action)).resolves.toMatchObject({
				fileId: 'file-1',
				isImage: false
			});

			expect(storeFileMock).toHaveBeenCalledOnce();
			expect(runMutation).not.toHaveBeenCalledWith('files.cleanUp.deleteFile', expect.anything());
		}
	);
});
