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
	import MessageBubble from '$lib/chat/ui/MessageBubble.svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import LockIcon from '@lucide/svelte/icons/lock';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { toast } from 'svelte-sonner';
	import { mode } from 'mode-watcher';

	import { page } from '$app/state';
	import { T, getTranslate } from '@tolgee/svelte';
	import type { OptimisticLocalStore } from 'convex/browser';
	import type { Id } from '$lib/convex/_generated/dataModel';

	const { t } = getTranslate();

	let { data } = $props();

	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
	const messages = useQuery(api.messages.list, {}, () => ({ initialData: data.messages }));

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

	// Fade animation
	const messagesFade = new FadeOnLoad();
	$effect(() => {
		if (messages.data && messages.data.length > 0 && !messagesFade.hasLoadedOnce) {
			messagesFade.markLoaded();
		}
	});

	// Resolve background color for bottom gradient
	let wrapperEl: HTMLDivElement | undefined = $state();
	let resolvedBg = $state('');

	$effect(() => {
		if (!wrapperEl) return;
		void mode.current;
		requestAnimationFrame(() => {
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
	});

	function isOwnMessage(userId: string): boolean {
		return viewer.data ? userId === viewer.data._id : false;
	}

	function isFirstInGroup(index: number): boolean {
		if (!messages.data || index === 0) return true;
		return messages.data[index]!.userId !== messages.data[index - 1]!.userId;
	}

	function getInitials(name: string) {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
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
								author: viewer.data!.name ?? 'You',
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
			toast.error($t('chat.messages.send_failed'));
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
		}
	}
</script>

<SEOHead
	title={$t('meta.app.community_chat.title')}
	description={$t('meta.app.community_chat.description')}
/>

{#if viewer.data}
	<div class="flex h-full flex-col">
		<!-- Messages area -->
		<div bind:this={wrapperEl} class="relative flex-1 overflow-hidden">
			<ChatContainerRoot ctx={chatCtx} class="h-full">
				<ChatContainerContent class="!h-full">
					{#if messages.data && messages.data.length > 0}
						<div class="mx-auto w-full max-w-3xl px-8 py-20 {messagesFade.animationClass}">
							{#each messages.data as message, index (message._id)}
								{@const own = isOwnMessage(message.userId)}
								{@const firstInGroup = isFirstInGroup(index)}
								<div
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

									<div class="flex min-w-0 flex-col gap-0.5 {own ? 'items-end' : 'items-start'}">
										{#if !own && firstInGroup}
											<span class="px-2 text-xs text-muted-foreground">
												{message.author}
											</span>
										{/if}
										<MessageBubble align={own ? 'right' : 'left'} variant="filled">
											<div class="flex flex-col gap-1">
												<p class="whitespace-pre-wrap break-words">
													{message.body}
												</p>
												<span
													class="whitespace-nowrap text-xs text-muted-foreground/60 {own
														? 'text-end'
														: ''}"
												>
													{formatTime(message._creationTime)}
												</span>
											</div>
										</MessageBubble>
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
			{#if !isPro && !hasMessagesAvailable}
				<div
					class="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-4 py-3 backdrop-blur-sm"
				>
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LockIcon class="size-4 shrink-0" />
						<span><T keyName="chat.alerts.limit_reached.title" /></span>
					</div>
					<Button
						size="sm"
						variant="default"
						onclick={handleUpgrade}
						disabled={upgradeOperation.isLoading}
					>
						{upgradeOperation.isLoading
							? $t('chat.buttons.processing')
							: $t('chat.buttons.upgrade')}
					</Button>
				</div>
			{:else if !isPro && remainingMessages <= 3 && remainingMessages > 0}
				<div
					class="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-4 py-3 backdrop-blur-sm"
				>
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<span>
							<T
								keyName={remainingMessages !== 1
									? 'chat.alerts.low_messages.description_plural'
									: 'chat.alerts.low_messages.description'}
								params={{ remaining: remainingMessages, total: totalMessages }}
							/>
						</span>
					</div>
					<Button
						size="sm"
						variant="outline"
						onclick={handleUpgrade}
						disabled={upgradeOperation.isLoading}
					>
						{upgradeOperation.isLoading
							? $t('chat.buttons.processing')
							: $t('chat.buttons.upgrade')}
					</Button>
				</div>
			{/if}

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
						maxlength={2000}
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
