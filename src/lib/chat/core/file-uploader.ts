/**
 * Chat file upload.
 *
 * Chat-specific request fields live here. The endpoint, the caller's
 * credentials, browser transport, cancelation, progress and the error
 * vocabulary are shared by every upload surface through
 * `#lib/uploads/upload-endpoint.js` and `#lib/uploads/transfer.js`.
 */

import type { FunctionReference } from 'convex/server';
import type { UploadPurpose } from '../../confect/files/uploadRoute.js';
import { UploadError, type UploadProgressCallback } from '../../uploads/transfer.js';
import { uploadToEndpoint } from '../../uploads/upload-endpoint.js';

/**
 * What every attachment upload hands to the composer once it succeeded.
 *
 * `fileId` is an opaque reference owned by the surface whose upload function
 * produced it. The composer stores it with the attachment and never reads it
 * as a storage id.
 */
export interface AttachmentUploadResult {
	fileId: string;
	url: string;
}

export type ChatVisitorArgs = { anonymousUserId?: string };

/** The upload route and caller identity consumed by the chat uploader. */
export interface ChatUploadApi {
	purpose: Exclude<UploadPurpose, 'profileImage'>;
	getVisitorArgs?: () => ChatVisitorArgs;
}

export type AttachmentTextAction = FunctionReference<
	'action',
	'public',
	{
		url: string;
		anonymousUserId?: string;
		locale?: string;
	},
	{ text: string; truncated: boolean }
>;

/** Retained public name for the chat uploader callback. */
export type ProgressCallback = UploadProgressCallback;

function decodeAttachment(body: unknown): AttachmentUploadResult {
	const fields = typeof body === 'object' && body !== null ? body : {};
	const fileId = 'fileId' in fields ? fields.fileId : undefined;
	const url = 'url' in fields ? fields.url : undefined;
	if (typeof fileId !== 'string' || typeof url !== 'string') throw new UploadError('parse');
	return { fileId, url };
}

/** Upload a chat attachment to the surface's upload route with progress tracking. */
export async function uploadFileWithProgress(
	file: File | Blob,
	filename: string,
	onProgress: ProgressCallback,
	api: ChatUploadApi,
	dimensions?: { width: number; height: number },
	signal?: AbortSignal
): Promise<AttachmentUploadResult> {
	const result = await uploadToEndpoint({
		purpose: api.purpose,
		blob: file,
		query: { filename, width: dimensions?.width, height: dimensions?.height },
		anonymousUserId: api.getVisitorArgs?.().anonymousUserId,
		decode: decodeAttachment,
		onProgress,
		signal
	});
	onProgress(100);
	return result;
}
