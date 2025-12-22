/**
 * File upload utilities
 *
 * Handles file uploads to Convex storage with progress tracking.
 */

import type { ConvexClient } from 'convex/browser';
import type { UploadState } from './types.js';

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
	}
): Promise<UploadResult> {
	// 1. Generate upload URL
	const uploadUrl = await client.mutation(api.generateUploadUrl, {});

	// 2. Upload file with progress tracking
	const storageId = await uploadToStorage(uploadUrl, file, onProgress);

	// 3. Register file with agent component
	const result = await client.action(api.saveUploadedFile, {
		storageId,
		filename,
		mimeType: file.type
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
 */
async function uploadToStorage(
	uploadUrl: string,
	file: File | Blob,
	onProgress: ProgressCallback
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
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
				} catch {
					reject(new Error('Failed to parse upload response'));
				}
			} else {
				reject(new Error(`Upload failed: ${xhr.statusText}`));
			}
		});

		// Handle errors
		xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
		xhr.addEventListener('abort', () => reject(new Error('Upload canceled')));

		// Start upload
		xhr.open('POST', uploadUrl);
		xhr.send(file);
	});
}

/**
 * Create initial upload state
 */
export function createUploadState(): UploadState {
	return {
		status: 'uploading',
		progress: 0
	};
}

/**
 * Create success upload state
 */
export function createSuccessState(fileId: string): UploadState {
	return {
		status: 'success',
		progress: 100,
		fileId
	};
}

/**
 * Create error upload state
 */
export function createErrorState(error: string): UploadState {
	return {
		status: 'error',
		progress: 0,
		error
	};
}

/**
 * Update upload progress
 */
export function updateProgress(state: UploadState, progress: number): UploadState {
	return {
		...state,
		progress
	};
}

/**
 * File upload manager for tracking multiple uploads
 */
export class FileUploadManager {
	private uploads = new Map<string, UploadState>();
	private abortControllers = new Map<string, AbortController>();

	/**
	 * Get upload state for a file
	 */
	getState(fileKey: string): UploadState | undefined {
		return this.uploads.get(fileKey);
	}

	/**
	 * Start tracking an upload
	 */
	startUpload(fileKey: string): void {
		this.uploads.set(fileKey, createUploadState());
		this.abortControllers.set(fileKey, new AbortController());
	}

	/**
	 * Update upload progress
	 */
	updateProgress(fileKey: string, progress: number): void {
		const state = this.uploads.get(fileKey);
		if (state) {
			this.uploads.set(fileKey, updateProgress(state, progress));
		}
	}

	/**
	 * Mark upload as successful
	 */
	completeUpload(fileKey: string, fileId: string): void {
		this.uploads.set(fileKey, createSuccessState(fileId));
		this.abortControllers.delete(fileKey);
	}

	/**
	 * Mark upload as failed
	 */
	failUpload(fileKey: string, error: string): void {
		this.uploads.set(fileKey, createErrorState(error));
		this.abortControllers.delete(fileKey);
	}

	/**
	 * Remove upload tracking
	 */
	removeUpload(fileKey: string): void {
		this.uploads.delete(fileKey);
		const controller = this.abortControllers.get(fileKey);
		if (controller) {
			controller.abort();
			this.abortControllers.delete(fileKey);
		}
	}

	/**
	 * Get abort signal for an upload
	 */
	getAbortSignal(fileKey: string): AbortSignal | undefined {
		return this.abortControllers.get(fileKey)?.signal;
	}

	/**
	 * Check if any uploads are in progress
	 */
	hasUploadsInProgress(): boolean {
		for (const state of this.uploads.values()) {
			if (state.status === 'uploading') {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if any uploads have failed
	 */
	hasFailedUploads(): boolean {
		for (const state of this.uploads.values()) {
			if (state.status === 'error') {
				return true;
			}
		}
		return false;
	}

	/**
	 * Get all successfully uploaded file IDs
	 */
	getSuccessfulFileIds(): string[] {
		const fileIds: string[] = [];
		for (const state of this.uploads.values()) {
			if (state.status === 'success' && state.fileId) {
				fileIds.push(state.fileId);
			}
		}
		return fileIds;
	}

	/**
	 * Clear all uploads
	 */
	clear(): void {
		for (const controller of this.abortControllers.values()) {
			controller.abort();
		}
		this.uploads.clear();
		this.abortControllers.clear();
	}
}
