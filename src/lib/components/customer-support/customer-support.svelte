<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte';
	import { uploadFileWithProgress } from './upload-helper';
	import type { UploadState } from './attachments.svelte';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);
	let screenshots = $state<Array<{ blob: Blob; filename: string; uploadState: UploadState }>>([]);
	let attachedFiles = $state<Array<{ file: File; preview?: string; uploadState: UploadState }>>([]);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	// Initialize thread context
	const threadContext = new SupportThreadContext();
	supportThreadContext.set(threadContext);

	// Get Convex client for mutations
	const client = useConvexClient();

	// Initialize thread when component mounts
	$effect(() => {
		initializeThread();
	});

	// Watch for widget open requests from chatbar
	$effect(() => {
		if (threadContext.shouldOpenWidget) {
			isFeedbackOpen = true;
			threadContext.clearWidgetOpenRequest();
		}
	});

	async function initializeThread() {
		// Check if we have a stored thread ID in sessionStorage
		const storedThreadId = sessionStorage.getItem('supportThreadId');

		if (storedThreadId) {
			threadContext.setThread(storedThreadId);
		} else {
			// Create a new thread
			try {
				const threadId = await client.mutation(api.support.threads.createThread, {});
				threadContext.setThread(threadId);
				sessionStorage.setItem('supportThreadId', threadId);
			} catch (error) {
				console.error('Failed to create support thread:', error);
				threadContext.setError('Failed to initialize chat. Please refresh the page.');
			}
		}
	}

	function handleScreenshotCancel() {
		isScreenshotMode = false;
	}

	async function handleScreenshotSaved(blob: Blob, filename: string) {
		const newScreenshot = {
			blob,
			filename,
			uploadState: { status: 'uploading' as const, progress: 0 }
		};

		screenshots = [...screenshots, newScreenshot];
		const index = screenshots.length - 1;

		try {
			const result = await uploadFileWithProgress(client, blob, filename, (progress) => {
				console.log(`[Upload Progress] ${filename}: ${progress.toFixed(1)}%`);
				// Trigger reactivity with full array reassignment
				screenshots = screenshots.map((s, idx) =>
					idx === index ? { ...s, uploadState: { ...s.uploadState, progress } } : s
				);
			});

			// Trigger reactivity with full array reassignment
			screenshots = screenshots.map((s, idx) =>
				idx === index
					? { ...s, uploadState: { status: 'success', progress: 100, fileId: result.fileId } }
					: s
			);
		} catch (error) {
			// Trigger reactivity with full array reassignment
			screenshots = screenshots.map((s, idx) =>
				idx === index
					? {
							...s,
							uploadState: {
								status: 'error',
								progress: 0,
								error: error instanceof Error ? error.message : 'Upload failed'
							}
						}
					: s
			);
		}
	}

	function handleClearScreenshot(index: number) {
		screenshots = screenshots.filter((_, i) => i !== index);
	}

	async function handleFilesAdded(files: File[]) {
		const newFiles = files.map((file) => ({
			file,
			preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
			uploadState: { status: 'uploading' as const, progress: 0 }
		}));

		attachedFiles = [...attachedFiles, ...newFiles];

		// Upload each file immediately
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const index = attachedFiles.length - files.length + i;

			try {
				const result = await uploadFileWithProgress(client, file, file.name, (progress) => {
					console.log(`[Upload Progress] ${file.name}: ${progress.toFixed(1)}%`);
					// Trigger reactivity with full array reassignment
					attachedFiles = attachedFiles.map((f, idx) =>
						idx === index ? { ...f, uploadState: { ...f.uploadState, progress } } : f
					);
				});

				// Trigger reactivity with full array reassignment
				attachedFiles = attachedFiles.map((f, idx) =>
					idx === index
						? { ...f, uploadState: { status: 'success', progress: 100, fileId: result.fileId } }
						: f
				);
			} catch (error) {
				// Trigger reactivity with full array reassignment
				attachedFiles = attachedFiles.map((f, idx) =>
					idx === index
						? {
								...f,
								uploadState: {
									status: 'error',
									progress: 0,
									error: error instanceof Error ? error.message : 'Upload failed'
								}
							}
						: f
				);
			}
		}
	}

	function handleRemoveFile(index: number) {
		// Revoke preview URL if it exists
		if (attachedFiles[index]?.preview) {
			URL.revokeObjectURL(attachedFiles[index].preview!);
		}
		attachedFiles = attachedFiles.filter((_, i) => i !== index);
	}

	// Cleanup preview URLs on unmount
	$effect(() => {
		return () => {
			attachedFiles.forEach((item) => {
				if (item.preview) {
					URL.revokeObjectURL(item.preview);
				}
			});
		};
	});
</script>

<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
<FeedbackButton
	bind:isOpen={isFeedbackOpen}
	bind:isScreenshotMode
	{screenshots}
	onClearScreenshot={handleClearScreenshot}
	{attachedFiles}
	onFilesAdded={handleFilesAdded}
	onRemoveFile={handleRemoveFile}
/>

{#if isScreenshotMode}
	<ScreenshotEditor onCancel={handleScreenshotCancel} onScreenshotSaved={handleScreenshotSaved} />
{/if}
