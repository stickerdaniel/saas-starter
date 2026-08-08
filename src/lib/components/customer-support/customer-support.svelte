<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { page } from '$app/state';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import { SupportThreadContext, supportThreadContext } from './support-thread-context.svelte.ts';
	import { ChatAttachmentStore, ChatUIContext, type UploadConfig } from '$lib/chat';
	import { browser } from '$app/environment';
	import { generateAnonymousUserId, isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import { supportUserId } from './support-user-id.svelte.ts';
	import { useSupportUrlState } from './use-support-url-state.svelte.ts';
	import { getTranslate } from '@tolgee/svelte';
	import { loadSentry } from '$lib/monitoring/sentry';
	import { PUBLIC_SENTRY_DSN } from '$env/static/public';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { getLegalEmailAddress } from '$lib/config/legal';
	import { buildMailto } from '$lib/utils/mailto';
	import { activeUploadsContext } from '$lib/hooks/active-uploads.svelte.ts';
	import { watch } from 'runed';
	import { isSupportAiEnabled } from '$lib/config/support';

	const { t } = getTranslate();

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

	// Pre-set skipAnimation if URL already has a thread (before FeedbackWidget mounts)
	if (urlState.thread) {
		threadContext.skipAnimation = true;
	}

	// URL state sync handlers
	function setWidgetOpen(open: boolean) {
		urlState.support = open ? 'open' : '';
		// Only while that thread is the one on screen. A closed widget left the
		// conversation but kept its id, so restoring the param on reopen would
		// claim a selected thread under a view showing the overview, and a
		// reload of that URL would open the conversation the visitor closed.
		if (open && threadContext.threadId && threadContext.currentView !== 'overview') {
			urlState.thread = threadContext.threadId;
		}
	}

	// A conversation still being acquired has no id yet, and the mutation that
	// gives it one resolves after the close and adopts it unless the view has
	// moved on — putting the id back into the URL of a closed widget. Only
	// that case leaves the chat view: an established conversation stays put,
	// so reopening resumes it rather than dropping the visitor on the list.
	watch(
		() => isFeedbackOpen,
		(open, wasOpen) => {
			if (wasOpen && !open && !threadContext.threadId) threadContext.goBack();
		}
	);

	function setThreadInUrl(threadId: string | null) {
		urlState.thread = threadId ?? '';
	}

	// Connect thread context to URL state
	threadContext.setOnThreadChange(setThreadInUrl);

	// Get Convex client for mutations
	const client = useConvexClient();

	// Provide client to thread context for eager thread creation
	threadContext.setClient(client);

	// Get auth state for user identification
	const auth = useAuth();

	// Session user id recovers via cookies on prerendered pages, unlike
	// page.data.viewer which is frozen at build time (prerendering
	// constraints in AGENTS.md)
	let sessionUserId = $state<string | null>(null);
	let sessionPending = $state(true);
	$effect(() => {
		return authClient.useSession().subscribe((s) => {
			sessionUserId = s.data?.user?.id ?? null;
			sessionPending = s.isPending;
		});
	});

	// Upload API configuration with locale for translated error messages
	const uploadConfig: UploadConfig = {
		generateUploadUrl: api.support.files.generateUploadUrl,
		saveUploadedFile: api.support.files.saveUploadedFile,
		getAttachmentText: api.support.files.getAttachmentText,
		locale: page.data.lang,
		translate: (key, params) => $t(key, params),
		getAccessKey: () => threadContext.threadId ?? threadContext.userId ?? 'support',
		attachmentStore: new ChatAttachmentStore('support'),
		getGenerateUploadUrlArgs: () => {
			const userId = threadContext.userId;
			const anonymousUserId = isAnonymousUser(userId) ? (userId ?? undefined) : undefined;
			return anonymousUserId ? { anonymousUserId } : {};
		}
	};

	// Create ChatUIContext at this level so we can handle screenshot uploads
	// Cast threadContext to ChatCore since it implements the required interface
	// Report transfers to the app so a navigation that would kill one asks first.
	// Absent outside the app shell (isolated tests, the standalone example), where
	// there is no layout to ask.
	const chatUIContext = new ChatUIContext(
		threadContext as any,
		client,
		uploadConfig,
		'right',
		activeUploadsContext.getOr(null)
	);

	// Revoke blob preview URLs of unsent attachments when the widget unmounts
	onDestroy(() => chatUIContext.dispose());

	/**
	 * Get or create an anonymous user ID stored in localStorage
	 */
	function getAnonymousId(): string {
		if (!browser) return '';

		if (!supportUserId.current) {
			supportUserId.current = generateAnonymousUserId();
		}
		return supportUserId.current;
	}

	/**
	 * Get the current user ID (authenticated or anonymous)
	 */
	function getUserId(): string {
		// Use authenticated user ID if available, otherwise fall back to anonymous ID
		return (auth.isAuthenticated && sessionUserId) || getAnonymousId();
	}

	// Initialize user ID when component mounts
	// Threads are now loaded reactively via useQuery in threads-overview.svelte
	$effect(() => {
		if (!browser || auth.isLoading) return;
		// Wait for the session of a signed-in user to resolve before falling
		// back, so we never mint a fresh anonymous id for them
		if (auth.isAuthenticated && sessionPending) return;
		const userId = getUserId();
		threadContext.setUserId(userId);
	});

	// Sync thread from URL only after validating that it is actually a support thread
	$effect(() => {
		const threadFromUrl = urlState.thread;
		const userId = threadContext.userId;

		if (!browser || !threadFromUrl || !userId || threadFromUrl === threadContext.threadId) {
			return;
		}

		const anonymousUserId = isAnonymousUser(userId) ? userId : undefined;
		let cancelled = false;

		void client
			.query(api.support.threads.getThread, {
				threadId: threadFromUrl,
				...(anonymousUserId ? { anonymousUserId } : {})
			})
			.then(() => {
				if (cancelled || urlState.thread !== threadFromUrl) return;
				threadContext.selectThreadFromUrl(threadFromUrl);
			})
			.catch((error) => {
				if (cancelled || urlState.thread !== threadFromUrl) return;

				console.warn('[customer-support] Ignoring invalid support thread URL:', error);
				threadContext.setThread(null);
				threadContext.currentView = 'overview';
				threadContext.skipAnimation = false;
				urlState.thread = '';
			});

		return () => {
			cancelled = true;
		};
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

	async function handleScreenshotSaved(
		blob: Blob,
		filename: string,
		dimensions: { width: number; height: number }
	) {
		// Upload screenshot via ChatUIContext (adds to ctx.attachments)
		await chatUIContext.uploadScreenshot(blob, filename, dimensions);
	}

	// Recoverable capture-failure flow: the editor reports the error, we tear the
	// overlay down and offer retry / contact support instead of a native alert().
	let captureErrorOpen = $state(false);
	let captureEventId = $state<string | undefined>(undefined);

	function handleScreenshotCaptureError(error: unknown) {
		isScreenshotMode = false;
		// Open the dialog immediately; the Sentry event id streams in once the
		// lazily loaded SDK (see $lib/monitoring/sentry) resolves.
		captureEventId = undefined;
		captureErrorOpen = true;
		if (browser && PUBLIC_SENTRY_DSN) {
			void loadSentry().then((sentry) => {
				captureEventId = sentry?.captureException(error);
			});
		}
	}

	function retryScreenshotCapture() {
		captureErrorOpen = false;
		isScreenshotMode = true;
	}

	function contactSupportAboutCapture() {
		const subject = $t('support.screenshot.error.email_subject');
		let body = $t('support.screenshot.error.email_body', { url: page.url.href });
		if (captureEventId) {
			body += `\n\n${$t('support.screenshot.error.email_reference', { id: captureEventId })}`;
		}
		// Plain location assignment, not an <a href>, so SvelteKit's client router
		// doesn't intercept the mailto and silently no-op the click.
		window.location.href = buildMailto({ email: getLegalEmailAddress(), subject, body });
		captureErrorOpen = false;
	}
</script>

<!-- The chatbar is the agent's own entry point: it offers to answer anything
     and carries the AI disclosure. With no agent behind it, it would promise
     a conversation partner that does not exist, so the widget is the only way
     in on such a build. -->
{#if isSupportAiEnabled()}
	<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
{/if}
<FeedbackButton {isFeedbackOpen} onToggle={setWidgetOpen} bind:isScreenshotMode {chatUIContext} />

<!--
	The editor is loaded on demand, and an await block with no catch rethrows a
	rejected import (svelte/src/internal/client/dom/blocks/await.js). A deploy can
	delete the chunk under a page that is still open, and the reload that would
	normally rescue it waits for confirmation while a file is uploading — so this
	failure is reachable, and without a boundary it takes the whole page down.
	Routed to the same place a failed capture goes: overlay down, retry offered.
-->
<svelte:boundary onerror={handleScreenshotCaptureError}>
	{#if isScreenshotMode}
		{#await import('./screenshot-editor/ScreenshotEditor.svelte') then { default: ScreenshotEditor }}
			<ScreenshotEditor
				onCancel={handleScreenshotCancel}
				onScreenshotSaved={handleScreenshotSaved}
				onCaptureError={handleScreenshotCaptureError}
			/>
		{/await}
	{/if}
</svelte:boundary>

<AlertDialog.Root bind:open={captureErrorOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{$t('support.screenshot.error.title')}</AlertDialog.Title>
			<AlertDialog.Description>
				{$t('support.screenshot.error.description')}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if captureEventId}
			<p class="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
				{$t('support.screenshot.error.event_id', { id: captureEventId })}
			</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (captureErrorOpen = false)}>
				{$t('support.screenshot.error.cancel')}
			</AlertDialog.Cancel>
			<Button variant="outline" onclick={contactSupportAboutCapture}>
				{$t('support.screenshot.error.contact')}
			</Button>
			<AlertDialog.Action onclick={retryScreenshotCapture}>
				{$t('support.screenshot.error.retry')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
