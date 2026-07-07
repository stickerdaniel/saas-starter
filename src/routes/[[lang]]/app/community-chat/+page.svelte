<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		PromptInput,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import {
		ChatContainerRoot,
		ChatContainerContent,
		ChatContainerScrollAnchor,
		ChatContainerContext
	} from '$lib/components/prompt-kit/chat-container';
	import { ScrollButton } from '$lib/components/prompt-kit/scroll-button';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import MessageQuotaBanner from '$lib/components/message-quota-banner.svelte';
	import { MAX_MESSAGE_LENGTH } from '$lib/chat/core/types';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { toast } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
	import { tick, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';

	import { page } from '$app/state';
	import { getTranslate } from '@tolgee/svelte';
	import type { OptimisticLocalStore } from 'convex/browser';
	import { ConvexError } from 'convex/values';
	import type { Id } from '$lib/convex/_generated/dataModel';

	const { t } = getTranslate();

	let { data } = $props();

	const client = useConvexClient();
	const viewerQuery = useQuery(api.users.viewer, {}, () => ({
		initialData: data.viewer ?? undefined
	}));
	const messagesQuery = useQuery(api.messages.list, {}, () => ({ initialData: data.messages }));

	// Fall back to server-loaded data for SSR (useQuery.data is undefined until hydration)
	const viewer = $derived({ data: viewerQuery.data ?? data.viewer });
	const messages = $derived({ data: messagesQuery.data ?? data.messages });

	// Billing
	const autumn = useCustomer();
	const upgradeOperation = useAutumnOperation(autumn.checkout);
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);
	const messagesFeature = $derived(autumn.customer?.features?.messages);
	const hasMessagesAvailable = $derived(isPro || (messagesFeature?.balance ?? 0) > 0);
	const remainingMessages = $derived(messagesFeature?.balance ?? 0);
	const totalMessages = $derived(
		messagesFeature?.included_usage === 'inf'
			? Infinity
			: typeof messagesFeature?.included_usage === 'number'
				? messagesFeature.included_usage
				: 0
	);

	// Input state
	let inputValue = $state('');
	let isSending = $state(false);

	// Scroll context
	const chatCtx = new ChatContainerContext();

	// Auto-focus input on mount
	onMount(() => {
		tick().then(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
	});

	// Fade animation
	const messagesFade = new FadeOnLoad();
	$effect(() => {
		if (messages.data && messages.data.length > 0 && !messagesFade.hasLoadedOnce) {
			messagesFade.markLoaded();
		}
	});

	// Arm per-message enter animations one frame after the initial batch has
	// rendered, so the loaded history doesn't replay an intro per message.
	let animateNewMessages = $state(false);
	$effect(() => {
		if (!messagesFade.hasLoadedOnce) return;
		const raf = requestAnimationFrame(() => (animateNewMessages = true));
		return () => cancelAnimationFrame(raf);
	});

	function messageEnterDuration(message: { _id: string; userId: string }): number {
		if (!animateNewMessages || prefersReducedMotion.current) return 0;
		// The confirmed row replaces its optimistic twin under a new _id; skip
		// that remount so an own send animates once, on the optimistic append.
		if (isOwnMessage(message.userId) && !message._id.startsWith('temp_')) return 0;
		return 200;
	}

	// Resolve background color for bottom gradient
	let wrapperEl: HTMLDivElement | undefined = $state();
	let resolvedBg = $state('');

	$effect(() => {
		if (!wrapperEl) return;
		void mode.current;
		const rafId = requestAnimationFrame(() => {
			let el: HTMLElement | null = wrapperEl!;
			while (el) {
				const bg = getComputedStyle(el).backgroundColor;
				if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
					resolvedBg = bg;
					return;
				}
				el = el.parentElement;
			}
		});
		return () => cancelAnimationFrame(rafId);
	});

	function isOwnMessage(userId: string): boolean {
		return viewer.data ? userId === viewer.data._id : false;
	}

	function isFirstInGroup(index: number): boolean {
		if (!messages.data || index === 0) return true;
		return messages.data[index]!.userId !== messages.data[index - 1]!.userId;
	}

	function getInitials(name: string) {
		return (name.trim()[0] ?? '').toUpperCase();
	}

	function getDisplayName(name: string) {
		return name.trim().split(/\s+/)[0] ?? name;
	}

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString(data.lang ?? 'en', {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function handleSend() {
		const text = inputValue.trim();
		if (!text || isSending || !hasMessagesAvailable) return;

		isSending = true;
		const bodyToSend = text;
		inputValue = '';
		haptic.trigger('medium');

		try {
			await client.mutation(
				api.messages.send,
				{ body: bodyToSend },
				{
					optimisticUpdate: (store: OptimisticLocalStore) => {
						const current = store.getQuery(api.messages.list, {});
						if (!current || !Array.isArray(current)) return;

						store.setQuery(api.messages.list, {}, [
							...current,
							{
								_id: `temp_${crypto.randomUUID()}` as Id<'messages'>,
								_creationTime: Date.now(),
								userId: viewer.data!._id,
								body: bodyToSend,
								author: viewer.data!.name ?? $t('common.you'),
								authorImage: viewer.data!.image ?? undefined
							}
						]);
					}
				}
			);
			await autumn.refetch();
		} catch (error) {
			console.error('Failed to send message:', error);
			haptic.trigger('error');
			// Restore the draft so the user can retry without retyping
			if (!inputValue) inputValue = bodyToSend;
			if (
				error instanceof ConvexError &&
				(error.data as { code?: string })?.code === 'RATE_LIMITED'
			) {
				const retryAfter = (error.data as { retryAfter?: number }).retryAfter ?? 60000;
				toast.error($t('chat.messages.rate_limited', { seconds: Math.ceil(retryAfter / 1000) }));
			} else {
				toast.error($t('chat.messages.send_failed'));
			}
		} finally {
			isSending = false;
		}
	}

	async function handleUpgrade() {
		haptic.trigger('light');
		const successUrl = new URL(page.url.href);
		successUrl.searchParams.set('upgraded', 'true');
		const result = await upgradeOperation.execute({
			productId: 'pro',
			successUrl: successUrl.href
		});
		if (result?.url) {
			window.location.href = result.url;
		} else if (upgradeOperation.error) {
			haptic.trigger('error');
			toast.error($t('billing.checkout_failed'));
			console.error('Checkout failed:', upgradeOperation.error);
		}
	}
</script>

<SEOHead
	title={$t('meta.app.community_chat.title')}
	description={$t('meta.app.community_chat.description')}
	noindex
/>

{#if viewer.data}
	<div class="flex h-full flex-col">
		<!-- Messages area -->
		<div bind:this={wrapperEl} class="relative flex-1 overflow-hidden">
			<ChatContainerRoot ctx={chatCtx} class="h-full">
				<ChatContainerContent class="!h-full">
					{#if messages.data && messages.data.length > 0}
						<!-- data-tolgee-restricted: user text may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
						<div
							data-tolgee-restricted
							class="mx-auto w-full max-w-3xl px-8 py-20 {messagesFade.animationClass}"
						>
							{#each messages.data as message, index (message._id)}
								{@const own = isOwnMessage(message.userId)}
								{@const firstInGroup = isFirstInGroup(index)}
								<div
									in:fly={{ y: 8, duration: messageEnterDuration(message) }}
									class="flex w-full gap-2 {own ? 'flex-row-reverse' : 'flex-row'} {firstInGroup
										? 'mt-6'
										: 'mt-1'}"
								>
									<!-- Avatar column for received messages -->
									{#if !own}
										<div class="mt-auto w-7 shrink-0">
											{#if firstInGroup}
												<Avatar.Root size="sm" class="size-7">
													<Avatar.Image src={message.authorImage} alt={message.author} />
													<Avatar.Fallback class="text-[10px]">
														{getInitials(message.author)}
													</Avatar.Fallback>
												</Avatar.Root>
											{/if}
										</div>
									{/if}

									<div
										class="flex min-w-0 flex-1 flex-col gap-0.5 {own ? 'items-end' : 'items-start'}"
									>
										{#if !own && firstInGroup}
											<span class="px-2 text-xs text-muted-foreground">
												{getDisplayName(message.author)}
											</span>
										{/if}
										<div
											class="relative max-w-[85%] rounded-2xl bg-primary/15 px-4 py-2.5 break-words text-foreground md:max-w-[75%]"
										>
											<span class="whitespace-pre-wrap">{message.body}</span>
											<span class="invisible ml-2 text-xs" aria-hidden="true">
												{formatTime(message._creationTime)}
											</span>
											<span
												class="absolute right-3 bottom-2 text-xs whitespace-nowrap text-muted-foreground/60"
											>
												{formatTime(message._creationTime)}
											</span>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
					<ChatContainerScrollAnchor />
				</ChatContainerContent>
			</ChatContainerRoot>

			<!-- Scroll button -->
			<div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 w-full">
				<ScrollButton
					class="pointer-events-auto absolute right-9 bottom-6 z-20 @min-3xl/main:right-auto @min-3xl/main:left-1/2 @min-3xl/main:-translate-x-1/2"
					isAtBottom={chatCtx.isAtBottom}
					onScrollToBottom={() => chatCtx.scrollToBottom()}
				/>
			</div>

			<!-- Progressive blur at bottom -->
			{#if messages.data && messages.data.length > 0}
				<div
					class="pointer-events-none absolute bottom-0 left-0 z-10"
					style="right: var(--scrollbar-w, 0px); height: 5rem;"
				>
					<ProgressiveBlur class="absolute inset-0" direction="bottom" blurIntensity={1} />
					{#if resolvedBg}
						<div
							class="absolute inset-x-0 bottom-0 h-4"
							style="background: linear-gradient(to bottom, transparent, {resolvedBg});"
						></div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Input area -->
		<div class="relative z-20 mx-auto w-full max-w-3xl -translate-y-4">
			<!-- Pro community chat is unlimited (hasMessagesAvailable is always true and
			     total is Infinity), so the banner's Pro branches never fire here -->
			<MessageQuotaBanner
				{isPro}
				{hasMessagesAvailable}
				remaining={remainingMessages}
				total={totalMessages}
				onUpgrade={handleUpgrade}
				isUpgrading={upgradeOperation.isLoading}
			/>

			<PromptInput
				class="mx-4 bg-popover p-0"
				value={inputValue}
				isLoading={isSending}
				onValueChange={(v) => (inputValue = v)}
				onSubmit={handleSend}
				maxHeight={120}
			>
				<div class="flex flex-col">
					<PromptInputTextarea
						placeholder={hasMessagesAvailable
							? $t('chat.input.placeholder')
							: $t('chat.input.placeholder_disabled')}
						class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
						maxlength={MAX_MESSAGE_LENGTH}
						disabled={!hasMessagesAvailable}
					/>

					<PromptInputActions class="mt-5 flex w-full items-center justify-end gap-2 px-3 pb-3">
						<Button
							size="icon"
							disabled={!inputValue.trim() || isSending || !hasMessagesAvailable}
							onclick={handleSend}
							class="size-9 shrink-0 rounded-full"
							aria-label={$t('chat.input.send_tooltip')}
						>
							<ArrowUpIcon class="h-[18px] w-[18px]" />
						</Button>
					</PromptInputActions>
				</div>
			</PromptInput>
		</div>
	</div>
{/if}
