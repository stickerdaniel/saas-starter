import { ConvexError } from 'convex/values';

export const FILE_ERROR_CODES = {
	fetchFailed: 'FILE_FETCH_FAILED',
	typeNotAllowed: 'FILE_TYPE_NOT_ALLOWED',
	tooLarge: 'FILE_TOO_LARGE',
	metadataLimit: 'FILE_METADATA_LIMIT',
	previewRateLimited: 'FILE_PREVIEW_RATE_LIMITED',
	uploadRateLimited: 'FILE_UPLOAD_RATE_LIMITED',
	storageUnavailable: 'FILE_STORAGE_UNAVAILABLE'
} as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[keyof typeof FILE_ERROR_CODES];

export function createFileError(
	code: FileErrorCode,
	data: Record<string, number | string | string[]> = {}
) {
	return new ConvexError({ code, ...data });
}
