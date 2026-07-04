/**
 * File upload utilities
 *
 * Handles file uploads to Convex storage with progress tracking.
 */

import type { ConvexClient } from 'convex/browser';

/**
 * Result from a successful file upload
 */
export interface UploadResult {
	fileId: string;
	url: string;
	storageId: string;
}

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: number) => void;

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
 * @param api - Convex API endpoints for file operations
 * @param dimensions - Optional image dimensions for storage
 * @returns Object containing fileId and url
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
	accessKey?: string
): Promise<UploadResult> {
	// 1. Generate upload URL (with optional extra args for rate limiting)
	const uploadUrlArgs = api.getGenerateUploadUrlArgs?.() ?? {};
	const { uploadUrl, uploadToken } = await client.mutation(api.generateUploadUrl, uploadUrlArgs);

	// 2. Upload file with progress tracking
	const storageId = await uploadToStorage(uploadUrl, file, onProgress);

	// 3. Register file with agent component (including dimensions for images)
	const result = await client.action(api.saveUploadedFile, {
		storageId,
		uploadToken,
		filename,
		mimeType: file.type,
		locale: api.locale,
		accessKey,
		width: dimensions?.width,
		height: dimensions?.height
	});

	// Ensure progress is 100% after completion
	onProgress(100);

	return {
		fileId: result.fileId,
		url: result.url,
		storageId
	};
}

/**
 * Upload file to storage URL with progress tracking via XHR
 *
 * Exported for upload flows that presign/commit through their own mutations
 * (e.g. profile images or app-specific file surfaces) but still want
 * progress events and cancelation.
 */
export async function uploadToStorage(
	uploadUrl: string,
	file: File | Blob,
	onProgress: ProgressCallback,
	signal?: AbortSignal
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const xhr = new XMLHttpRequest();

		if (signal) {
			if (signal.aborted) {
				reject(new DOMException('Upload canceled', 'AbortError'));
				return;
			}
			signal.addEventListener('abort', () => xhr.abort(), { once: true });
		}

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
				} catch {
					reject(new Error('Failed to parse upload response'));
				}
			} else {
				reject(new Error(`Upload failed: ${xhr.statusText}`));
			}
		});

		// Handle errors
		xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
		xhr.addEventListener('abort', () => reject(new DOMException('Upload canceled', 'AbortError')));

		// Start upload
		xhr.open('POST', uploadUrl);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.send(file);
	});
}
