import { storeFile } from '@convex-dev/agent';
import { components, internal } from '../../convex/_generated/api';
import type { ActionCtx } from '../../convex/_generated/server';
import { FILE_ERROR_CODES, createFileError } from './errors';
import type { UploadRegistrationArgsSchema } from './schemas';
import { releaseUploadStaging, UPLOAD_STAGING_TTL_MS } from './staging';
import { validateUploadBlob } from './upload';

export async function registerUpload(
	ctx: ActionCtx,
	args: typeof UploadRegistrationArgsSchema.Type,
	defaultAccessKey: string
) {
	const accessKey = args.accessKey?.trim() || defaultAccessKey;
	await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
		uploadToken: args.uploadToken,
		storageId: args.storageId,
		accessKeys: [accessKey],
		expiresAt: Date.now() + UPLOAD_STAGING_TTL_MS
	});

	try {
		const downloadGrant = await ctx.runMutation(
			components.convexFilesControl.download.createDownloadGrant,
			{
				storageId: args.storageId,
				maxUses: 1,
				expiresAt: Date.now() + 5 * 60 * 1000,
				shareableLink: false
			}
		);

		const downloadResult = await ctx.runMutation(
			components.convexFilesControl.download.consumeDownloadGrantForUrl,
			{
				downloadToken: downloadGrant.downloadToken,
				accessKey
			}
		);

		if (downloadResult.status !== 'ok' || !downloadResult.downloadUrl) {
			throw new Error(`Failed to get download URL: ${downloadResult.status}`);
		}

		const response = await fetch(downloadResult.downloadUrl);
		if (!response.ok) {
			throw createFileError(FILE_ERROR_CODES.fetchFailed);
		}
		const blob = await response.blob();
		const verifiedMimeType = validateUploadBlob(blob, args.locale);

		const { file } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		if (args.width && args.height && verifiedMimeType.startsWith('image/')) {
			await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
				fileId: file.fileId,
				storageId: file.storageId,
				url: file.url,
				width: args.width,
				height: args.height
			});
		}

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: verifiedMimeType.startsWith('image/')
		};
	} finally {
		await releaseUploadStaging(ctx, args.storageId);
	}
}
