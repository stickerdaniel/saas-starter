<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { PromptInput, PromptInputTextarea } from '$lib/components/prompt-kit/prompt-input';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowUp, Square } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';

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
		if (!input.trim()) return;

		const prompt = input.trim();

		// Clear input immediately for better UX
		input = '';

		try {
			await threadContext.sendMessage(client, prompt, {
				openWidgetAfter: true
			});
		} catch (error) {
			// Error already handled in sendMessage
			console.error('[handleSubmit] Error:', error);
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
		<div class="ai-gradient-wrapper-glow pointer-events-none"></div>
		<div class="ai-gradient-wrapper pointer-events-none"></div>
		<!-- Pill background layer -->
		<div class="ai-pill-bg pointer-events-none"></div>

		<PromptInput
			value={input}
			onValueChange={handleValueChange}
			isLoading={threadContext.isSending}
			onSubmit={handleSubmit}
			class="relative z-[1] mb-1 flex w-full flex-row items-center border-0 bg-transparent !p-1 shadow-none"
		>
			<PromptInputTextarea
				class="!h-auto !min-h-auto rounded-full bg-transparent !py-0 "
				placeholder="Ask me anything..."
				onfocus={handleFocus}
				onblur={handleBlur}
			/>

			<Button
				variant="secondary"
				size="icon"
				class="h-8 w-8 rounded-full text-muted-foreground"
				onclick={handleSubmit}
				disabled={!input.trim() || threadContext.isSending}
			>
				{#if threadContext.isSending}
					<Square class="size-5 fill-current" />
				{:else}
					<ArrowUp class="size-5" />
				{/if}
			</Button>
		</PromptInput>
	</div>
</div>

<style>
	:global(.ai-gradient-wrapper),
	:global(.ai-gradient-wrapper-glow) {
		position: absolute;
		inset: -2px;
		border-radius: 50px;
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
		border-radius: 42px;
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
