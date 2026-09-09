import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_PROFILES } from './profiles.js';
import { getProfileImageInputError, prepareProfileImage } from './profile-image.js';
import type { UploadPreprocessor } from './transfer.js';

function imageFile(type: string, size = 1): File {
	return new File([new Uint8Array(size)], 'avatar', { type });
}

describe('profile image input validation', () => {
	it('accepts a transcodable source format that is not storable as-is', () => {
		expect(getProfileImageInputError(imageFile('image/heic'))).toBeUndefined();
	});

	it('rejects non-image input before requesting an upload grant', () => {
		expect(getProfileImageInputError(imageFile('text/plain'))).toBe('type');
	});

	it('enforces the profile source-size cap', () => {
		const tooLarge = imageFile('image/png', UPLOAD_PROFILES.profileImage.maxBytes + 1);
		expect(getProfileImageInputError(tooLarge)).toBe('size');
	});
});

describe('profile image preparation', () => {
	it('accepts a downscaled storage format through the shared preprocessor interface', async () => {
		const output = new Blob(['webp'], { type: 'image/webp' });
		const preprocess: UploadPreprocessor<File> = vi.fn(async () => ({
			blob: output,
			mimeType: output.type
		}));
		const source = imageFile('image/heic');

		await expect(prepareProfileImage(source, preprocess)).resolves.toEqual({
			ok: true,
			blob: output,
			mimeType: 'image/webp'
		});
		expect(preprocess).toHaveBeenCalledWith(source);
	});

	it('validates the actual blob type rather than preprocessor metadata', async () => {
		const output = new Blob(['svg'], { type: 'image/svg+xml' });
		const preprocess: UploadPreprocessor<File> = async () => ({
			blob: output,
			mimeType: 'image/webp'
		});

		await expect(prepareProfileImage(imageFile('image/svg+xml'), preprocess)).resolves.toEqual({
			ok: false,
			reason: 'type'
		});
	});

	it('rejects fallback bytes whose output type cannot be stored', async () => {
		const output = new Blob(['svg'], { type: 'image/svg+xml' });
		const preprocess: UploadPreprocessor<File> = async () => ({
			blob: output,
			mimeType: output.type
		});

		await expect(prepareProfileImage(imageFile('image/svg+xml'), preprocess)).resolves.toEqual({
			ok: false,
			reason: 'type'
		});
	});
});
