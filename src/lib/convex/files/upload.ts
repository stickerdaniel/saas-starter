import { FILE_ERROR_CODES, createFileError } from './errors';
import { acceptsMimeType, UPLOAD_PROFILES, type UploadProfile } from '../../uploads/profiles';

/**
 * Upload validation against a declared profile.
 *
 * The constraints themselves live in `$lib/uploads/profiles`, shared with the
 * client so the picker and this validator cannot disagree about a format. They
 * used to be a second hand-maintained copy of the client list (#782).
 */

/** Maximum upload size for chat attachments (5MB). */
export const MAX_FILE_SIZE = UPLOAD_PROFILES.chatAttachment.maxBytes;

/** MIME types accepted for chat attachments. */
export const ALLOWED_MIME_TYPES = Array.from(
	new Set(Object.values(UPLOAD_PROFILES.chatAttachment.extensions))
);

/**
 * Validate a fetched upload blob against a profile's size and MIME constraints.
 *
 * Validates against the actual blob, not the client-supplied MIME type which is
 * untrusted input and could be spoofed. Compares the MIME essence only: text/*
 * often comes back with a charset suffix (e.g. "text/plain; charset=utf-8").
 *
 * @returns the verified MIME essence (lowercased, no parameters)
 * @throws {ConvexError} when the blob exceeds the size cap or its type is not allowed
 */
export function validateUploadBlob(
	blob: Blob,
	_locale: string | undefined,
	profile: UploadProfile = UPLOAD_PROFILES.chatAttachment
): string {
	if (blob.size > profile.maxBytes) {
		throw createFileError(FILE_ERROR_CODES.tooLarge, {
			maxBytes: profile.maxBytes,
			actualBytes: blob.size
		});
	}

	const mimeEssence = blob.type.split(';')[0]!.trim().toLowerCase();
	if (!acceptsMimeType(profile, mimeEssence)) {
		throw createFileError(FILE_ERROR_CODES.typeNotAllowed, {
			allowedTypes: Object.keys(profile.extensions)
		});
	}

	return mimeEssence;
}
