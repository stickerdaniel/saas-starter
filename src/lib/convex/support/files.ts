import { action } from '../_generated/server';
import { v } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { components } from '../_generated/api';

/**
 * Upload a file or image to Convex storage for use in agent messages
 *
 * This action stores the file in Convex storage and returns metadata
 * that can be used to construct multimodal messages for the AI agent.
 *
 * @returns fileId, storageId, and url for the stored file
 */
export const uploadFile = action({
	args: {
		blob: v.string(), // Base64-encoded blob data
		filename: v.optional(v.string()),
		mimeType: v.string()
	},
	handler: async (
		ctx,
		args
	): Promise<{
		fileId: string;
		storageId: string;
		url: string;
		filename: string | undefined;
		mimeType: string;
		isImage: boolean;
	}> => {
		// Convert base64 string back to ArrayBuffer
		const binaryString = atob(args.blob);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		const arrayBuffer = bytes.buffer;

		// Create a Blob from the ArrayBuffer
		const blob = new Blob([arrayBuffer], { type: args.mimeType });

		// Store the file using the agent component
		const { file, imagePart } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			mimeType: args.mimeType,
			isImage: !!imagePart
		};
	}
});
