import { downscaleImage } from '../utils/downscale-image.js';
import { acceptsMimeType, acceptsSource, UPLOAD_PROFILES } from './profiles.js';
import type { UploadPreprocessor } from './transfer.js';

const PROFILE = UPLOAD_PROFILES.profileImage;

export type ProfileImageInputError = 'type' | 'size';

/** Validate picked bytes before any grant is requested. */
export function getProfileImageInputError(file: File): ProfileImageInputError | undefined {
	if (!acceptsSource(PROFILE, file.type)) return 'type';
	if (file.size > PROFILE.maxBytes) return 'size';
	return undefined;
}

export type ProfileImagePreparation =
	{ ok: true; blob: Blob; mimeType: string } | { ok: false; reason: 'type' };

/**
 * Avatar-specific preparation behind the shared upload-preprocessor shape.
 *
 * The downscaler is injectable for deterministic tests. Its output is checked
 * because it may intentionally pass a GIF through or fall back to the original
 * bytes when decoding/encoding fails.
 */
export async function prepareProfileImage(
	file: File,
	preprocess: UploadPreprocessor<File> = async (input) => {
		const blob = await downscaleImage(input);
		return { blob, mimeType: blob.type };
	}
): Promise<ProfileImagePreparation> {
	const prepared = await preprocess(file);
	const mimeType = prepared.blob.type;
	if (!acceptsMimeType(PROFILE, mimeType)) return { ok: false, reason: 'type' };
	return { ok: true, blob: prepared.blob, mimeType };
}
