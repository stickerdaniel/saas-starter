import { ConvexError } from 'convex/values';
import { t } from '../i18n/translations';

/**
 * Shared upload constraints and validation for chat-style file attachments
 * (aiChat and support). Both features accept the same file types and size cap.
 */

/** Maximum upload size for chat attachments (5MB). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** MIME types accepted for chat attachments. */
export const ALLOWED_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf',
	'text/markdown',
	'text/plain'
];

/**
 * Validate a fetched upload blob against the shared size and MIME constraints.
 *
 * Validates against the actual blob, not the client-supplied MIME type which is
 * untrusted input and could be spoofed. Compares the MIME essence only: text/*
 * often comes back with a charset suffix (e.g. "text/plain; charset=utf-8").
 *
 * @returns the verified MIME essence (lowercased, no parameters)
 * @throws {ConvexError} when the blob exceeds the size cap or its type is not allowed
 */
export function validateUploadBlob(blob: Blob, locale: string | undefined): string {
	if (blob.size > MAX_FILE_SIZE) {
		const maxMB = Math.round(MAX_FILE_SIZE / 1024 / 1024);
		throw new ConvexError(
			t(locale, 'backend.files.file_too_large', {
				size: `${(blob.size / 1024 / 1024).toFixed(1)}MB`,
				max: `${maxMB}MB`
			})
		);
	}

	const mimeEssence = blob.type.split(';')[0]!.trim().toLowerCase();
	if (!ALLOWED_MIME_TYPES.includes(mimeEssence)) {
		throw new ConvexError(t(locale, 'backend.files.type_not_allowed'));
	}

	return mimeEssence;
}
