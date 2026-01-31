<script lang="ts">
	import { tick } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/convex/_generated/api';
	import { PromptInput, PromptInputTextarea } from '$lib/components/prompt-kit/prompt-input';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { supportThreadContext } from './support-thread-context.svelte';
	import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let input = $state('');
	let isFocused = $state(false);
	const { isFeedbackOpen = false } = $props<{ isFeedbackOpen?: boolean }>();

	// Get thread context
	const threadContext = supportThreadContext.get();

	// Get Convex client for mutations
	const client = useConvexClient();

	// eslint-disable-next-line svelte/prefer-writable-derived -- mounted needs to be set after hydration via effect
	let mounted = $state(false);

	// Track delayed feedback open state
	const delayedFeedbackOpen = $derived(isFeedbackOpen);

	// Local thread tracking - separate from shared context
	// AI chatbar always creates fresh threads, stored locally until submit
	// Pending thread is reused if user clears and retypes (no wasted threads)
	let pendingThreadId = $state<string | null>(null);
	let threadCreationPromise: Promise<string> | null = null;

	// Query subscription for pre-warming cache (enables optimistic updates)
	// The onUpdate return type is a function that can be called to unsubscribe
	let queryUnsubscribe: (() => void) | null = null;

	$effect(() => {
		mounted = true;
	});

	async function handleSubmit() {
		if (!input.trim() || threadContext.isSending) return;

		const trimmedPrompt = input.trim();
		console.log(
			'[AI Chatbar] handleSubmit - Starting message send, pendingThreadId:',
			pendingThreadId,
			'threadCreationPromise:',
			!!threadCreationPromise
		);

		// Set isSending FIRST to prevent handleBlur from deleting the thread
		// This must happen before clearing input
		threadContext.setSending(true);
		threadContext.setAwaitingStream(true);
		console.log('[AI Chatbar] Set isSending=true to prevent thread deletion on blur');

		// Now safe to clear input and open widget
		input = '';
		threadContext.requestWidgetOpen();
		console.log('[AI Chatbar] Widget open requested');

		try {
			// Wait for pending thread if still creating
			console.log('[AI Chatbar] Waiting for thread...');
			const threadId = pendingThreadId || (await threadCreationPromise!);
			console.log('[AI Chatbar] Thread ready:', threadId);

			// Update shared context (selectThread sets view='chat' + URL sync)
			console.log('[AI Chatbar] Selecting thread in shared context:', threadId);
			threadContext.selectThread(threadId);

			// Force Svelte to re-render so ChatRoot subscribes before mutation
			console.log('[AI Chatbar] Waiting for tick() to ensure ChatRoot subscribes');
			await tick();
			console.log('[AI Chatbar] tick() completed, ChatRoot should be subscribed');

			// Build query args for optimistic update (must match ChatRoot's query exactly)
			const queryArgs: ListMessagesArgs = {
				threadId,
				paginationOpts: { numItems: 50, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};
			console.log('[AI Chatbar] Preparing optimistic update with args:', queryArgs);

			// Send message with Convex's built-in optimistic update
			console.log('[AI Chatbar] Sending message with optimistic update...');
			await client.mutation(
				api.support.messages.sendMessage,
				{
					threadId,
					prompt: trimmedPrompt,
					userId: threadContext.userId || undefined
				},
				{
					optimisticUpdate: createOptimisticUpdate(
						api.support.messages.listMessages,
						queryArgs,
						'user',
						trimmedPrompt
					)
				}
			);
			console.log('[AI Chatbar] Message sent successfully with optimistic update');

			// Reset local state for next fresh thread
			console.log('[AI Chatbar] Resetting local thread state');
			pendingThreadId = null;
			threadCreationPromise = null;

			// Cleanup query subscription after ChatRoot takes over (delayed to let ChatRoot subscribe first)
			setTimeout(() => {
				if (queryUnsubscribe) {
					console.log('[AI Chatbar] Cleaning up pre-subscribe query');
					queryUnsubscribe();
					queryUnsubscribe = null;
				}
			}, 500);
		} catch (error) {
			console.error('[AI Chatbar] handleSubmit Error:', error);

			// Handle rate limit errors with user-friendly toast
			if (error instanceof ConvexError) {
				const data = error.data as { code?: string; retryAfter?: number } | undefined;
				if (data?.code === 'RATE_LIMITED') {
					const retryAfter = data.retryAfter || 60000;
					const seconds = Math.ceil(retryAfter / 1000);
					threadContext.setRateLimited(retryAfter);
					toast.error($t('support.widget.error.rate_limit', { seconds }));
				} else {
					toast.error($t('support.widget.error.send_failed'));
				}
			} else {
				toast.error($t('support.widget.error.send_failed'));
			}

			threadContext.setAwaitingStream(false);
			// Optimistic update automatically rolled back by Convex
		} finally {
			threadContext.setSending(false);
			console.log('[AI Chatbar] Set isSending=false, submit complete');
		}
	}

	function handleValueChange(value: string) {
		input = value;

		// Create pending thread on first keystroke (or reuse existing pending thread)
		// Always creates fresh thread locally - ignores any existing context thread
		if (value.trim() && !pendingThreadId && !threadCreationPromise) {
			console.log('[AI Chatbar] Eager thread creation started on first keystroke');
			console.log(
				'[AI Chatbar] Current state - pendingThreadId:',
				pendingThreadId,
				'threadCreationPromise:',
				!!threadCreationPromise
			);

			threadCreationPromise = client
				.mutation(api.support.threads.createThread, {
					userId: threadContext.userId || undefined,
					pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
				})
				.then((result) => {
					console.log('[AI Chatbar] Thread created successfully:', result.threadId);
					pendingThreadId = result.threadId;

					// Pre-subscribe to messages query so it's cached by submit time
					// This ensures optimistic update finds the query in cache
					const preSubscribeArgs = {
						threadId: result.threadId,
						paginationOpts: { numItems: 50, cursor: null },
						streamArgs: { kind: 'list' as const, startOrder: 0 }
					};
					console.log('[AI Chatbar] Pre-subscribing to messages query for:', result.threadId);
					queryUnsubscribe = client.onUpdate(
						api.support.messages.listMessages,
						preSubscribeArgs,
						() => {
							console.log('[AI Chatbar] Query cache warmed for:', result.threadId);
						}
					);

					return result.threadId;
				})
				.catch((error) => {
					console.error('[AI Chatbar] Thread creation failed:', error);
					throw error;
				});
		}
	}

	function handleFocus() {
		isFocused = true;
		console.log(
			'[AI Chatbar] handleFocus - input focused, pendingThreadId:',
			pendingThreadId,
			'threadCreationPromise:',
			!!threadCreationPromise
		);
	}

	function handleBlur() {
		isFocused = false;
		console.log(
			'[AI Chatbar] handleBlur - pendingThreadId:',
			pendingThreadId,
			'isSending:',
			threadContext.isSending
		);
		// Don't delete pending thread on blur - automatic cleanup handles unused threads
		// Query subscription stays active for faster optimistic updates on re-focus
	}
</script>

<!-- Glow container with group hover/focus behavior -->
<div
	class="ai-chatbar fixed bottom-5 left-1/2 z-[100] w-full -translate-x-1/2 pr-19 pl-5 md:mb-0 md:p-0 {!mounted ||
	delayedFeedbackOpen
		? 'fade-out'
		: ''}"
>
	<div
		class="group relative mx-auto transition-all duration-300 ease-in-out {isFocused
			? 'max-w-[430px]'
			: 'max-w-[280px]'}"
	>
		<!-- Gradient glow layers (behind) - not affected by fade animation -->
		<div class="ai-gradient-wrapper-glow pointer-events-none rounded-3xl"></div>
		<div class="ai-gradient-wrapper pointer-events-none rounded-3xl"></div>
		<!-- Pill background layer - outside content wrapper to stay aligned with gradients -->
		<div class="ai-pill-bg pointer-events-none rounded-3xl"></div>

		<!-- Content wrapper with separate opacity animation -->
		<div class="ai-chatbar-content">
			<PromptInput
				value={input}
				onValueChange={handleValueChange}
				isLoading={threadContext.isSending}
				onSubmit={handleSubmit}
				class="relative z-[1] mb-1 flex w-full flex-row items-center border-0 bg-transparent !p-1 shadow-none"
			>
				<PromptInputTextarea
					class="!h-auto !min-h-auto rounded-3xl bg-transparent !py-0 "
					placeholder={$t('support.chatbar.placeholder')}
					onfocus={handleFocus}
					onblur={handleBlur}
				/>

				<Button
					variant="secondary"
					size="icon"
					class="h-8 w-8 rounded-full text-muted-foreground"
					onclick={handleSubmit}
					disabled={!input.trim() || threadContext.isSending || threadContext.hasPendingToolCalls}
					aria-label={$t('chat.aria.send')}
				>
					{#if threadContext.isSending}
						<LoaderCircleIcon class="size-5 animate-spin" />
					{:else}
						<ArrowUpIcon class="size-5" />
					{/if}
				</Button>
			</PromptInput>
		</div>
	</div>
</div>

<style>
	:global(.ai-gradient-wrapper),
	:global(.ai-gradient-wrapper-glow) {
		position: absolute;
		inset: -2px;
		overflow: hidden;
		transition:
			inset 0.2s ease-in-out,
			opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	:global(.ai-gradient-wrapper-glow) {
		filter: blur(15px);
	}
	:global(.ai-gradient-wrapper::before),
	:global(.ai-gradient-wrapper-glow::before) {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 99999px;
		height: 99999px;
		background-repeat: no-repeat;
		background-position: 0 0;
		opacity: 0.4;
		background-image: conic-gradient(
			transparent,
			rgb(182, 224, 220),
			rgb(234, 239, 140),
			rgb(253, 193, 158),
			rgb(242, 155, 229),
			rgb(196, 174, 255),
			transparent 95%
		);
		filter: blur(20px);
		transform: translate(-50%, -50%) rotate(0deg);
		transition: opacity 0.5s ease-in-out;
		animation: border-spin 4s linear infinite;
		pointer-events: none;
	}
	:global(.group:hover .ai-gradient-wrapper),
	:global(.group:focus-within .ai-gradient-wrapper),
	:global(.group:hover .ai-gradient-wrapper-glow),
	:global(.group:focus-within .ai-gradient-wrapper-glow) {
		inset: -4px;
	}
	:global(.group:hover .ai-gradient-wrapper-glow::before) {
		opacity: 1;
	}
	:global(.ai-pill-bg) {
		position: absolute;
		inset: 0;
		z-index: 0;
		background: #ffffff;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
	}
	:global(.dark .ai-pill-bg) {
		background-color: rgba(80, 80, 80, 0.68);
		backdrop-filter: blur(24px);
	}
	/* Base transition for smooth state changes - transform only on container */
	:global(.ai-chatbar) {
		transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* Content wrapper handles opacity animation separately from gradient */
	:global(.ai-chatbar-content) {
		position: relative;
		z-index: 1;
		transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* Pill bg needs opacity transition for fade */
	:global(.ai-pill-bg) {
		transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* Hidden state, applied when feedback widget is open or before mount */
	:global(.ai-chatbar.fade-out) {
		transform: translateY(20px);
		transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
	:global(.ai-chatbar.fade-out .ai-chatbar-content),
	:global(.ai-chatbar.fade-out .ai-pill-bg),
	:global(.ai-chatbar.fade-out .ai-gradient-wrapper),
	:global(.ai-chatbar.fade-out .ai-gradient-wrapper-glow) {
		opacity: 0;
		transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@keyframes border-spin {
		0% {
			transform: translate(-50%, -50%) rotate(0deg);
		}
		100% {
			transform: translate(-50%, -50%) rotate(-360deg);
		}
	}
</style>
