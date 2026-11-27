<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '#lib/auth-client.js';
	import { page } from '$app/state';
	import AIChatbar from '#lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '#lib/components/customer-support/feedback-button.svelte';
	import { SupportContext, supportContext } from './support-context.svelte.ts';
	import { ChatUIContext, type UploadConfig } from '#lib/chat/ui/chat-context.svelte.ts';
	import { chatComposerFor } from '#lib/chat/ui/chat-composer.svelte.ts';
	import { browser } from '$app/env';
	import { generateAnonymousUserId, isAnonymousUser } from '#lib/confect/utils/anonymousUser.js';
	import { supportUserId } from './support-user-id.svelte.ts';
	import { useSupportUrlState } from './use-support-url-state.svelte.ts';
	import { getTranslate } from '@tolgee/svelte';
	import { loadSentry } from '#lib/monitoring/sentry.js';
	import { PUBLIC_SENTRY_DSN } from '$app/env/public';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getLegalEmailAddress } from '#lib/config/legal.js';
	import { buildMailto, reportPageUrl } from '#lib/utils/mailto.js';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';
	import { watch } from 'runed';
	import { isSupportAiEnabled } from '#lib/config/support.js';

	const { t } = getTranslate();
	const capabilityQuery = useQuery(
		api.capabilities.getUsability,
		{},
		{
			initialData: page.data.capabilitiesResolved ? page.data.capabilities : undefined
		}
	);
	const capabilitiesResolved = $derived(capabilityQuery.data !== undefined);
	const aiUsable = $derived(capabilityQuery.data?.ai.usable === true);

	const urlState = useSupportUrlState();

	const isFeedbackOpen = $derived(urlState.support === 'open');

	let isScreenshotMode = $state(false);

	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	// Initialize the customer-support composition root. Its composer outlives
	// this component: the page it sits on can be left and entered again before a
	// reply settles. A session that ends while the widget stays mounted empties
	// the composer in place, and the selected thread and open widget stay. The
	// widget stores a draft when its thread is left, not on every keystroke.
	const support = new SupportContext(
		() => aiUsable,
		chatComposerFor('support', { saveDrafts: 'on-switch', storeFiles: true })
	);
	supportContext.set(support);
	const { navigation, conversation } = support;

	// skipAnimation is set before FeedbackWidget mounts when the URL already has a thread
	if (urlState.thread) {
		navigation.skipAnimation = true;
	}

	function setWidgetOpen(open: boolean) {
		urlState.support = open ? 'open' : '';
		// Only while that thread is the one on screen. A closed widget left the
		// conversation but kept its id, so restoring the param on reopen would
		// claim a selected thread under a view showing the overview, and a
		// reload of that URL would open the conversation the visitor closed.
		if (open && conversation.threadId && navigation.currentView !== 'overview') {
			urlState.thread = conversation.threadId;
		}
	}

	// A conversation still being acquired has no id yet, and the mutation that
	// gives it one resolves after the close and adopts it unless the view has
	// moved on, which puts the id back into the URL of a closed widget. Only that
	// case leaves the chat view: an established conversation stays put, so
	// reopening resumes it instead of dropping the visitor on the list.
	watch(
		() => isFeedbackOpen,
		(open, wasOpen) => {
			if (wasOpen && !open && !conversation.threadId) support.goBack();
		}
	);

	// Set while the widget follows a thread change browser history already made.
	// The URL holds the result, and writing it again would push a new entry over
	// the one Forward returns to.
	let followingUrlHistory = false;

	function setThreadInUrl(threadId: string | null) {
		if (followingUrlHistory) return;
		urlState.thread = threadId ?? '';
	}

	navigation.setOnThreadChange(setThreadInUrl);

	const client = useConvexClient();

	// The conversation creates threads eagerly through the client
	conversation.setClient(client);

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

	// The locale lets upload errors arrive translated
	const uploadConfig: UploadConfig = {
		purpose: 'support',
		getAttachmentText: api.support.files.getAttachmentText,
		locale: page.data.lang,
		translate: (key, params) => $t(key, params),
		getVisitorArgs: () => {
			const userId = conversation.userId;
			const anonymousUserId = isAnonymousUser(userId) ? (userId ?? undefined) : undefined;
			return anonymousUserId ? { anonymousUserId } : {};
		}
	};

	// ChatUIContext lives at this level to handle screenshot uploads. Transfers
	// are reported to the app, so a navigation that would kill one asks first. The
	// registry is absent outside the app shell (isolated tests, the standalone
	// example), where no layout asks.
	const chatUIContext = new ChatUIContext(
		conversation,
		client,
		support.composer,
		uploadConfig,
		'right',
		activeUploadsContext.getOr(null)
	);

	// Revokes the blob preview URLs of unsent attachments
	onDestroy(() => chatUIContext.dispose());

	function getAnonymousId(): string {
		if (!browser) return '';

		if (!supportUserId.current) {
			supportUserId.current = generateAnonymousUserId();
		}
		return supportUserId.current;
	}

	function getUserId(): string {
		return (auth.isAuthenticated && sessionUserId) || getAnonymousId();
	}

	// Threads load reactively through useQuery in threads-overview.svelte
	$effect(() => {
		if (!browser || auth.isLoading) return;
		// A signed-in user's session resolves first, so no fresh anonymous id is
		// minted for them
		if (auth.isAuthenticated && sessionPending) return;
		const userId = getUserId();
		conversation.setUserId(userId);
	});

	// The URL thread under validation and the user it is validated for. The effect
	// below reruns on any URL write, such as opening the widget, and only a new
	// target or user retires earlier work.
	let validating: { threadId: string; userId: string } | null = null;

	// The URL thread syncs only after validation as a support thread. A matching
	// id is settled only while its conversation is on screen: going back to the
	// list keeps the id, so a later Forward to it must reopen it here.
	$effect(() => {
		const threadFromUrl = urlState.thread;
		const userId = conversation.userId;

		if (
			!browser ||
			!threadFromUrl ||
			!userId ||
			(threadFromUrl === conversation.threadId && navigation.currentView !== 'overview')
		) {
			validating = null;
			return;
		}

		const anonymousUserId = isAnonymousUser(userId) ? userId : undefined;
		let cancelled = false;

		// A new URL target, or a new user validating it, is newer than any work
		// started before it, such as a submit still acquiring its warm thread. That
		// work retires now; the thread itself is adopted only once validated. The
		// widget's own URL writes return above, because they name the conversation
		// already on screen, and a rerun for the target and user already under
		// validation retires nothing.
		if (validating?.threadId !== threadFromUrl || validating.userId !== userId) {
			validating = { threadId: threadFromUrl, userId };
			navigation.invalidateOperation();
		}

		void client
			.query(api.support.threads.getThread, {
				threadId: threadFromUrl,
				...(anonymousUserId ? { anonymousUserId } : {})
			})
			.then((thread) => {
				if (cancelled || urlState.thread !== threadFromUrl) return;
				validating = null;
				support.selectThreadFromUrl(threadFromUrl, thread);
			})
			.catch(() => {
				if (cancelled || urlState.thread !== threadFromUrl) return;
				validating = null;

				console.warn('[CustomerSupport.resolveThreadUrl] Invalid');
				conversation.setThread(null);
				navigation.setView('overview');
				navigation.skipAnimation = false;
				urlState.thread = '';
			});

		return () => {
			cancelled = true;
		};
	});

	// An empty thread param names no conversation, so when browser history
	// drops the one on screen, the open widget follows it back to the list.
	// The widget's own writes that clear the param never match: each one
	// leaves that conversation or the chat view in the same update.
	watch(
		() => urlState.thread,
		(thread, previousThread) => {
			if (
				!thread &&
				previousThread &&
				isFeedbackOpen &&
				navigation.currentView !== 'overview' &&
				conversation.threadId === previousThread
			) {
				followingUrlHistory = true;
				try {
					support.goBack();
				} finally {
					followingUrlHistory = false;
				}
			}
		}
	);

	$effect(() => {
		if (navigation.shouldOpenWidget) {
			setWidgetOpen(true);
			navigation.clearWidgetOpenRequest();
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
		// Adds the screenshot to the chat attachment list
		await chatUIContext.uploadScreenshot(blob, filename, dimensions);
	}

	// Recoverable capture failure: the editor reports the error, the overlay comes
	// down, and retry or contact support is offered instead of a native alert().
	let captureErrorOpen = $state(false);
	let captureEventId = $state<string | undefined>(undefined);

	function handleScreenshotCaptureError(error: unknown) {
		isScreenshotMode = false;
		// Open the dialog immediately; the Sentry event id streams in once the
		// lazily loaded SDK (see #lib/monitoring/sentry) resolves.
		captureEventId = undefined;
		captureErrorOpen = true;
		if (browser && PUBLIC_SENTRY_DSN) {
			void loadSentry().then((sentry) => {
				captureEventId = sentry?.captureException(error);
			});
		}
	}

	// Resolves to null after routing a failed chunk load to the capture-error flow.
	// A handler chained onto import() would run inside Vite's preload wrapper and
	// swallow the vite:preloadError that app.html answers with a reload.
	async function loadScreenshotEditor() {
		try {
			const module = await import('./screenshot-editor/ScreenshotEditor.svelte');
			return module.default;
		} catch (error) {
			handleScreenshotCaptureError(error);
			return null;
		}
	}

	function retryScreenshotCapture() {
		captureErrorOpen = false;
		isScreenshotMode = true;
	}

	function contactSupportAboutCapture() {
		const subject = $t('support.screenshot.error.email_subject');
		let body = $t('support.screenshot.error.email_body', { url: reportPageUrl(page.url) });
		if (captureEventId) {
			body += `\n\n${$t('support.screenshot.error.email_reference', { id: captureEventId })}`;
		}
		// Plain location assignment, not an <a href>, so SvelteKit's client router
		// does not intercept the mailto and silently drop the click.
		window.location.href = buildMailto({ email: getLegalEmailAddress(), subject, body });
		captureErrorOpen = false;
	}
</script>

<!-- The chatbar is the agent's own entry point: it offers to answer anything
     and carries the AI disclosure. With no agent behind it, it would promise
     a conversation partner that does not exist, so the widget is the only way
     in on such a build. -->
{#if isSupportAiEnabled() && aiUsable}
	<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
{/if}
<FeedbackButton
	{isFeedbackOpen}
	disabled={!capabilitiesResolved}
	onToggle={setWidgetOpen}
	bind:isScreenshotMode
	{chatUIContext}
/>

<!--
	The editor is loaded on demand. A deploy can delete its chunk under a page
	that is still open. The stale-deploy reload in app.html is the first rescue,
	but it waits while a file is uploading and fires once per session, so the
	import can still reject here. An await block with no catch rethrows that
	rejection from a promise callback, where no <svelte:boundary> sees it, and
	the page would stay in screenshot mode with neither editor nor launcher.
	loadScreenshotEditor handles the rejection outside Vite's preload wrapper, so
	app.html still sees the failure. The boundary handles errors thrown by the
	loaded editor, from its effects or during creation. It sits inside the
	fulfilled branch because that branch is also created in a promise callback,
	so a boundary around the await block would miss a creation error. Both go
	where a failed capture goes: overlay down, retry offered. The boundary sits
	inside the screenshot-mode block so every retry gets a fresh one.
-->
{#if isScreenshotMode}
	{#await loadScreenshotEditor() then ScreenshotEditor}
		{#if ScreenshotEditor}
			<svelte:boundary onerror={handleScreenshotCaptureError}>
				<ScreenshotEditor
					onCancel={handleScreenshotCancel}
					onScreenshotSaved={handleScreenshotSaved}
					onCaptureError={handleScreenshotCaptureError}
				/>
			</svelte:boundary>
		{/if}
	{/await}
{/if}

<AlertDialog.Root bind:open={captureErrorOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{$t('support.screenshot.error.title')}</AlertDialog.Title>
			<AlertDialog.Description>
				{$t('support.screenshot.error.description')}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if captureEventId}
			<p
				class="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-muted-foreground selectable"
			>
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
