<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);
	let screenshots = $state<Array<{ blob: Blob; filename: string }>>([]);
	let attachedFiles = $state<Array<{ file: File; preview?: string }>>([]);

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

	function handleScreenshotSaved(blob: Blob, filename: string) {
		screenshots = [...screenshots, { blob, filename }];
	}

	function handleClearScreenshot(index: number) {
		screenshots = screenshots.filter((_, i) => i !== index);
	}

	function handleFilesAdded(files: File[]) {
		const newFiles = files.map((file) => {
			// Generate preview for images
			let preview: string | undefined;
			if (file.type.startsWith('image/')) {
				preview = URL.createObjectURL(file);
			}
			return { file, preview };
		});
		attachedFiles = [...attachedFiles, ...newFiles];
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
