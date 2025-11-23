import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';

/**
 * Upload a file to Convex storage with progress tracking
 *
 * This function handles the complete upload flow:
 * 1. Generate upload URL from Convex
 * 2. Upload file directly to storage with progress events
 * 3. Register file with agent component
 *
 * @param client - Convex client instance
 * @param file - File or Blob to upload
 * @param filename - Name for the uploaded file
 * @param onProgress - Callback for progress updates (0-100)
 * @returns Object containing fileId and url
 */
export async function uploadFileWithProgress(
	client: ConvexClient,
	file: File | Blob,
	filename: string,
	onProgress: (progress: number) => void
): Promise<{ fileId: string; url: string }> {
	// 1. Generate upload URL
	const uploadUrl = await client.mutation(api.support.files.generateUploadUrl, {});

	// 2. Upload file with progress tracking
	const storageId = (await new Promise<string>((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		// Track upload progress
		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable) {
				const percent = (e.loaded / e.total) * 100;
				onProgress(percent);
			}
		});

		// Handle successful upload
		xhr.addEventListener('load', () => {
			if (xhr.status === 200) {
				try {
					const response = JSON.parse(xhr.responseText);
					resolve(response.storageId);
				} catch (error) {
					reject(new Error('Failed to parse upload response'));
				}
			} else {
				reject(new Error(`Upload failed: ${xhr.statusText}`));
			}
		});

		// Handle errors
		xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
		xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

		// Start upload
		xhr.open('POST', uploadUrl);
		xhr.send(file);
	})) as any;

	// 3. Register file with agent component
	const result = await client.action(api.support.files.saveUploadedFile, {
		storageId: storageId,
		filename,
		mimeType: file.type
	});

	// Ensure progress is 100% after completion
	onProgress(100);

	return {
		fileId: result.fileId,
		url: result.url
	};
}
