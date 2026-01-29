<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { page } from '$app/state';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte';
	import { ChatUIContext, type UploadConfig } from '$lib/chat';
	import { browser } from '$app/environment';
	import { generateAnonymousUserId } from '$lib/convex/utils/anonymousUser';
	import { useSupportUrlState } from './use-support-url-state.svelte';

	// URL state for shareable links
	const urlState = useSupportUrlState();

	// Widget open state derived from URL
	const isFeedbackOpen = $derived(urlState.support === 'open');

	let isScreenshotMode = $state(false);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	// Initialize thread context
	const threadContext = new SupportThreadContext();
	supportThreadContext.set(threadContext);

	// URL state sync handlers
	function setWidgetOpen(open: boolean) {
		urlState.support = open ? 'open' : '';
		if (!open) {
			urlState.thread = ''; // Clear thread when closing widget
		}
	}

	function setThreadInUrl(threadId: string | null) {
		urlState.thread = threadId ?? '';
	}

	// Connect thread context to URL state
	threadContext.setOnThreadChange(setThreadInUrl);

	// Sync thread from URL on mount/change
	$effect(() => {
		const threadFromUrl = urlState.thread;
		if (threadFromUrl && threadFromUrl !== threadContext.threadId) {
			// Open widget and load thread from URL
			threadContext.selectThreadFromUrl(threadFromUrl);
		}
	});

	// Get Convex client for mutations
	const client = useConvexClient();

	// Provide client to thread context for eager thread creation
	threadContext.setClient(client);

	// Get auth state for user identification
	const auth = useAuth();

	// Upload API configuration with locale for translated error messages
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile,
		locale: page.data.lang
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
			id = generateAnonymousUserId();
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
		if (!browser || auth.isLoading) return;
		const userId = getUserId();
		threadContext.setUserId(userId);
	});

	// Watch for widget open requests from chatbar
	$effect(() => {
		if (threadContext.shouldOpenWidget) {
			setWidgetOpen(true);
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
<FeedbackButton {isFeedbackOpen} onToggle={setWidgetOpen} bind:isScreenshotMode {chatUIContext} />

{#if isScreenshotMode}
	{#await import('./screenshot-editor/ScreenshotEditor.svelte') then { default: ScreenshotEditor }}
		<ScreenshotEditor onCancel={handleScreenshotCancel} onScreenshotSaved={handleScreenshotSaved} />
	{/await}
{/if}
