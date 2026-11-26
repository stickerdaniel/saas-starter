import * as Effect from 'effect/Effect';
import { FileRefusal } from '../errorCodecs';
import { FILE_ERROR_CODES, createFileError } from './errors';
import { acceptsMimeType, UPLOAD_PROFILES, type UploadProfile } from '../../uploads/profiles';

export const presignedUploadRefusal = Effect.fail(
	new FileRefusal({ refusal: { code: FILE_ERROR_CODES.storageUnavailable } })
);

/**
 * Upload validation against a declared profile.
 *
 * The constraints themselves live in `#lib/uploads/profiles.js`, shared with the
 * client so the picker and this validator cannot disagree about a format. They
 * used to be a second hand-maintained copy of the client list (#782).
 */

/** Maximum upload size for chat attachments (5MB). */
export const MAX_FILE_SIZE = UPLOAD_PROFILES.chatAttachment.maxBytes;

/** MIME types accepted for chat attachments. */
export const ALLOWED_MIME_TYPES = Array.from(
	new Set(Object.values(UPLOAD_PROFILES.chatAttachment.extensions))
);

const SIGNATURES: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number | undefined>>>> = {
	'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	'image/jpeg': [[0xff, 0xd8, 0xff]],
	'image/gif': [
		[0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
		[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
	],
	'image/webp': [
		[0x52, 0x49, 0x46, 0x46, undefined, undefined, undefined, undefined, 0x57, 0x45, 0x42, 0x50]
	],
	'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]]
};

const SIGNATURE_BYTES = 12;

const startsWith = (head: Uint8Array, signature: ReadonlyArray<number | undefined>) =>
	signature.every((byte, index) => byte === undefined || head[index] === byte);

async function contentMatches(blob: Blob, mimeEssence: string): Promise<boolean> {
	if (mimeEssence.startsWith('text/')) {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const binary = Object.values(SIGNATURES).flat();
		return !bytes.includes(0) && !binary.some((signature) => startsWith(bytes, signature));
	}
	const signatures = SIGNATURES[mimeEssence];
	if (signatures === undefined) return false;
	const head = new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer());
	return signatures.some((signature) => startsWith(head, signature));
}

/**
 * Validates an upload against a profile's size cap, its declared MIME type and
 * the file's bytes.
 *
 * The declared type comes from the request's Content-Type header. A binary type
 * passes only when the first bytes carry that format's signature, and a text type
 * only when the bytes contain no NUL byte and start with no binary signature. Compares the MIME
 * essence only, so "text/plain; charset=utf-8" counts as text/plain.
 *
 * @returns the same bytes typed with the MIME essence (lowercased, no parameters),
 *   so a stored file never carries the header's raw value
 * @throws {ConvexError} when the blob exceeds the size cap, its type is not
 *   allowed, or its bytes do not match the type
 */
export async function validateUpload(
	blob: Blob,
	profile: UploadProfile = UPLOAD_PROFILES.chatAttachment
): Promise<Blob> {
	if (blob.size > profile.maxBytes) {
		throw createFileError(FILE_ERROR_CODES.tooLarge, {
			maxBytes: profile.maxBytes,
			actualBytes: blob.size
		});
	}

	const mimeEssence = blob.type.split(';')[0]!.trim().toLowerCase();
	if (!acceptsMimeType(profile, mimeEssence) || !(await contentMatches(blob, mimeEssence))) {
		throw createFileError(FILE_ERROR_CODES.typeNotAllowed, {
			allowedTypes: Object.keys(profile.extensions)
		});
	}

	return new Blob([blob], { type: mimeEssence });
}
