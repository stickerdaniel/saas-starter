/**
 * Chat file upload adapter.
 *
 * Chat-specific grant/commit arguments live here. Browser transport,
 * cancelation, progress, and provider-error normalization are shared by every
 * upload surface through `$lib/uploads/transfer`.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { GenericId } from 'convex/values';
import { storageIdFromUploadResponse } from '../../uploads/convex-storage-id.js';
import {
	uploadWithAdapter,
	type UploadAdapter,
	type UploadGrant,
	type UploadProgressCallback
} from '../../uploads/transfer.js';

/** Result from a successful chat attachment upload. */
export interface UploadResult {
	fileId: string;
	url: string;
	storageId: string;
}

export type ChatUploadGrantArgs = { anonymousUserId?: string };
export type ChatUploadCommitArgs = {
	storageId: GenericId<'_storage'>;
	uploadToken: string;
	filename?: string;
	mimeType: string;
	locale?: string;
	accessKey?: string;
	width?: number;
	height?: number;
};
export type ChatUploadCommitResult = { fileId: string; url: string };

/** Endpoints and identity arguments consumed by the chat upload adapter. */
export interface ChatUploadApi {
	generateUploadUrl: FunctionReference<'mutation', 'public', ChatUploadGrantArgs, UploadGrant>;
	saveUploadedFile: FunctionReference<
		'action',
		'public',
		ChatUploadCommitArgs,
		ChatUploadCommitResult
	>;
	locale?: string;
	getGenerateUploadUrlArgs?: () => ChatUploadGrantArgs;
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
	api: ChatUploadApi,
	dimensions?: { width: number; height: number },
	accessKey?: string,
	signal?: AbortSignal
): Promise<UploadResult> {
	const adapter: UploadAdapter<ChatUploadCommitResult> = {
		grant: async () => {
			const uploadUrlArgs = api.getGenerateUploadUrlArgs?.() ?? {};
			return await client.mutation(api.generateUploadUrl, uploadUrlArgs);
		},
		commit: async ({ storageId, uploadToken }) => {
			return await client.action(api.saveUploadedFile, {
				storageId: storageIdFromUploadResponse(storageId),
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
