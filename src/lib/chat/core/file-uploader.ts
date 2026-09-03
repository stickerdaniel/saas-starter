/**
 * Chat file upload adapter.
 *
 * Chat-specific grant/commit arguments live here. Browser transport,
 * cancelation, progress, and provider-error normalization are shared by every
 * upload surface through `$lib/uploads/transfer`.
 */

import type { ConvexClient } from 'convex/browser';
import {
	uploadWithAdapter,
	type UploadAdapter,
	type UploadProgressCallback
} from '../../uploads/transfer.js';

/** Result from a successful chat attachment upload. */
export interface UploadResult {
	fileId: string;
	url: string;
	storageId: string;
}

/** Retained public name for the chat uploader callback. */
export type ProgressCallback = UploadProgressCallback;

/**
 * Upload a chat attachment to Convex storage with progress tracking.
 *
 * The shared adapter owns grant -> storage POST -> commit mechanics. This
 * wrapper contributes only chat policy: generate arguments, file metadata,
 * locale, access key, and the agent file result shape.
 */
export async function uploadFileWithProgress(
	client: ConvexClient,
	file: File | Blob,
	filename: string,
	onProgress: ProgressCallback,
	api: {
		generateUploadUrl: Parameters<ConvexClient['mutation']>[0];
		saveUploadedFile: Parameters<ConvexClient['action']>[0];
		locale?: string;
		/** Provider for extra args to pass to generateUploadUrl (e.g., anonymousUserId for rate limiting) */
		getGenerateUploadUrlArgs?: () => Record<string, unknown>;
	},
	dimensions?: { width: number; height: number },
	accessKey?: string,
	signal?: AbortSignal
): Promise<UploadResult> {
	type ChatCommitResult = { fileId: string; url: string };

	const adapter: UploadAdapter<ChatCommitResult> = {
		grant: async () => {
			const uploadUrlArgs = api.getGenerateUploadUrlArgs?.() ?? {};
			return await client.mutation(api.generateUploadUrl, uploadUrlArgs);
		},
		commit: async ({ storageId, uploadToken }) => {
			return await client.action(api.saveUploadedFile, {
				storageId,
				uploadToken,
				filename,
				mimeType: file.type,
				locale: api.locale,
				accessKey,
				width: dimensions?.width,
				height: dimensions?.height
			});
		}
	};

	const { storageId, value } = await uploadWithAdapter({
		adapter,
		blob: file,
		onProgress,
		signal
	});

	return {
		fileId: value.fileId,
		url: value.url,
		storageId
	};
}
