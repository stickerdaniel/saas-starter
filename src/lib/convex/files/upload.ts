import { ConvexError } from 'convex/values';
import { t } from '../i18n/translations';
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
	locale: string | undefined,
	profile: UploadProfile = UPLOAD_PROFILES.chatAttachment
): string {
	if (blob.size > profile.maxBytes) {
		const maxMB = Math.round(profile.maxBytes / 1024 / 1024);
		throw new ConvexError(
			t(locale, 'backend.files.file_too_large', {
				size: `${(blob.size / 1024 / 1024).toFixed(1)}MB`,
				max: `${maxMB}MB`
			})
		);
	}

	const mimeEssence = blob.type.split(';')[0]!.trim().toLowerCase();
	if (!acceptsMimeType(profile, mimeEssence)) {
		throw new ConvexError(t(locale, 'backend.files.type_not_allowed'));
	}

	return mimeEssence;
}
