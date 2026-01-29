<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/convex/_generated/api';
	import { PromptInput, PromptInputTextarea } from '$lib/components/prompt-kit/prompt-input';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
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

	let mounted = $state(false);
	let delayedFeedbackOpen = $state(false);

	$effect(() => {
		mounted = true;
	});

	$effect(() => {
		if (isFeedbackOpen) {
			delayedFeedbackOpen = true;
			return;
		}

		const timer = setTimeout(() => {
			delayedFeedbackOpen = false;
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});

	async function handleSubmit() {
		if (!input.trim() || threadContext.isSending) return;

		const trimmedPrompt = input.trim();

		// Clear input immediately for better UX
		input = '';

		// Start new thread (triggers eager creation)
		threadContext.startNewThread();
		threadContext.setSending(true);
		threadContext.setAwaitingStream(true);

		try {
			// Wait for thread to be created
			const threadId = await threadContext.ensureThread(client);

			// Build query args for optimistic update (must match ChatRoot's query exactly)
			const queryArgs: ListMessagesArgs = {
				threadId,
				paginationOpts: { numItems: 50, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};

			// Send message with optimistic update via Convex's store.setQuery
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

			// Open widget after successful send
			threadContext.requestWidgetOpen();
		} catch (error) {
			console.error('[ai-chatbar handleSubmit] Error:', error);

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
		}
	}

	function handleValueChange(value: string) {
		input = value;
	}

	function handleFocus() {
		isFocused = true;
	}

	function handleBlur() {
		isFocused = false;
	}
</script>

<!-- Glow container with group hover/focus behavior -->
<div
	class="group ai-chatbar fixed bottom-5 left-1/2 z-[100] w-full -translate-x-1/2 pr-19 pl-5 md:mb-0 md:p-0 {!mounted ||
	delayedFeedbackOpen
		? 'fade-out'
		: ''}"
>
	<div
		class="relative mx-auto transition-all duration-300 ease-in-out {isFocused
			? 'max-w-[430px]'
			: 'max-w-[280px]'}"
	>
		<!-- Gradient glow layers (behind) -->
		<div class="ai-gradient-wrapper-glow pointer-events-none rounded-3xl"></div>
		<div class="ai-gradient-wrapper pointer-events-none rounded-3xl"></div>
		<!-- Pill background layer -->
		<div class="ai-pill-bg pointer-events-none rounded-3xl"></div>

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
				<ArrowUpIcon class="size-5" />
			</Button>
		</PromptInput>
	</div>
</div>

<style>
	:global(.ai-gradient-wrapper),
	:global(.ai-gradient-wrapper-glow) {
		position: absolute;
		inset: -2px;
		overflow: hidden;
		transition: inset 0.2s ease-in-out;
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
	/* Base transition for smooth state changes */
	:global(.ai-chatbar) {
		transition:
			opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1),
			transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* Hidden state, applied when feedback widget is open or before mount */
	:global(.ai-chatbar.fade-out) {
		opacity: 0;
		transform: translateY(20px);
		transition:
			opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
			transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
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
