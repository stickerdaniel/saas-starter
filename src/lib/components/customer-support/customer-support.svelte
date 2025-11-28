<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	// Initialize thread context
	const threadContext = new SupportThreadContext();
	supportThreadContext.set(threadContext);

	// Get Convex client for mutations
	const client = useConvexClient();

	// Upload API configuration
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile
	};

	// Create ChatUIContext at this level so we can handle screenshot uploads
	// Cast threadContext to ChatCore since it implements the required interface
	const chatUIContext = new ChatUIContext(threadContext as any, client, uploadConfig);

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
		// Upload screenshot via ChatUIContext (adds to ctx.attachments)
		await chatUIContext.uploadScreenshot(blob, filename);
	}
</script>

<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
<FeedbackButton bind:isFeedbackOpen bind:isScreenshotMode {chatUIContext} />

{#if isScreenshotMode}
	<ScreenshotEditor onCancel={handleScreenshotCancel} onScreenshotSaved={handleScreenshotSaved} />
{/if}
