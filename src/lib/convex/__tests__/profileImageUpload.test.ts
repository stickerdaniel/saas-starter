// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(async () => ({ _id: 'user-1', role: 'user' })),
		safeGetAuthUser: vi.fn()
	}
}));

vi.mock('../rateLimit', () => ({
	appRateLimiter: { limit: vi.fn(async () => ({ ok: true })) }
}));

vi.mock('../_generated/api', () => ({
	components: {
		convexFilesControl: {
			upload: { finalizeUpload: 'files.upload.finalizeUpload' },
			download: { createDownloadGrant: 'files.download.createDownloadGrant' },
			cleanUp: { deleteFile: 'files.cleanUp.deleteFile' }
		}
	}
}));

import { updateProfileImage } from '../storage';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from '../constants';

type UpdateProfileImageHandler = {
	_handler: (ctx: unknown, args: { storageId: string; uploadToken: string }) => Promise<string>;
};

const handler = updateProfileImage as unknown as UpdateProfileImageHandler;
const SITE_URL = 'https://site.test';

let runMutation: ReturnType<typeof vi.fn>;

function uploadWithMetadata(metadata: { contentType: string | null; size: number } | null) {
	runMutation = vi.fn(async (reference: string) => {
		switch (reference) {
			case 'files.upload.finalizeUpload':
				return { metadata };
			case 'files.download.createDownloadGrant':
				return { downloadToken: 'download-token' };
			case 'files.cleanUp.deleteFile':
				return null;
			default:
				throw new Error(`Unexpected mutation ${reference}`);
		}
	});
	return handler._handler({ runMutation }, { storageId: 'storage-1', uploadToken: 'upload-token' });
}

beforeEach(() => {
	vi.stubEnv('CONVEX_SITE_URL', SITE_URL);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

// The avatar picker accepts any image family because the browser transcodes
// before upload, and the transcoder can hand an SVG back unchanged. This
// mutation is what keeps such bytes from becoming a public avatar, whatever
// the client did.
describe('updateProfileImage', () => {
	it.each([
		['an SVG', { contentType: 'image/svg+xml', size: 100 }],
		['an empty type', { contentType: '', size: 100 }],
		// The component reports an absent storage content type as null.
		['a missing type', { contentType: null, size: 100 }]
	])('refuses %s without issuing a public grant', async (_label, metadata) => {
		await expect(uploadWithMetadata(metadata)).rejects.toMatchObject({
			data: { code: 'FILE_TYPE_NOT_ALLOWED' }
		});

		expect(runMutation).toHaveBeenCalledWith('files.cleanUp.deleteFile', {
			storageId: 'storage-1'
		});
		expect(runMutation).not.toHaveBeenCalledWith(
			'files.download.createDownloadGrant',
			expect.anything()
		);
	});

	it('refuses an oversized image without issuing a public grant', async () => {
		await expect(
			uploadWithMetadata({ contentType: 'image/png', size: PROFILE_IMAGE_MAX_SIZE + 1 })
		).rejects.toMatchObject({ data: { code: 'FILE_TOO_LARGE' } });

		expect(runMutation).not.toHaveBeenCalledWith(
			'files.download.createDownloadGrant',
			expect.anything()
		);
	});

	it.each(PROFILE_IMAGE_ALLOWED_TYPES)('returns an inline avatar URL for %s', async (type) => {
		await expect(uploadWithMetadata({ contentType: type, size: 100 })).resolves.toBe(
			`${SITE_URL}/files/inline?token=download-token`
		);

		expect(runMutation).not.toHaveBeenCalledWith('files.cleanUp.deleteFile', expect.anything());
	});
});
