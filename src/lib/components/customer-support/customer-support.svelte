<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { page } from '$app/state';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat';
	import { browser } from '$app/environment';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	// Initialize thread context
	const threadContext = new SupportThreadContext();
	supportThreadContext.set(threadContext);

	// Get Convex client for mutations
	const client = useConvexClient();

	// Get auth state for user identification
	const auth = useAuth();

	// Upload API configuration
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile
	};

	// Create ChatUIContext at this level so we can handle screenshot uploads
	// Cast threadContext to ChatCore since it implements the required interface
	const chatUIContext = new ChatUIContext(threadContext as any, client, uploadConfig);

	/**
	 * Get or create an anonymous user ID stored in localStorage
	 */
	function getAnonymousId(): string {
		if (!browser) return '';

		let id = localStorage.getItem('supportUserId');
		if (!id) {
			id = `anon_${crypto.randomUUID()}`;
			localStorage.setItem('supportUserId', id);
		}
		return id;
	}

	/**
	 * Get the current user ID (authenticated or anonymous)
	 */
	function getUserId(): string {
		// Use authenticated user ID if available, otherwise fall back to anonymous ID
		const viewer = page.data.viewer;
		return (auth.isAuthenticated && viewer?._id) || getAnonymousId();
	}

	// Initialize user ID when component mounts
	// Threads are now loaded reactively via useQuery in threads-overview.svelte
	$effect(() => {
		if (browser) {
			const userId = getUserId();
			threadContext.setUserId(userId);
		}
	});

	// Watch for widget open requests from chatbar
	$effect(() => {
		if (threadContext.shouldOpenWidget) {
			isFeedbackOpen = true;
			threadContext.clearWidgetOpenRequest();
		}
	});

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
