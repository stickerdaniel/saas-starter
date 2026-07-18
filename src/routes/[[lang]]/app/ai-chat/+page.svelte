<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { ConvexError } from 'convex/values';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import ThreadChat from './thread-chat.svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	const { t } = getTranslate();

	let { data } = $props();

	const client = useConvexClient();

	// Auth
	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer ?? undefined }));

	// Pro check
	const autumn = useCustomer();
	const upgradeOperation = useAutumnOperation(autumn.checkout);
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);
	const aiChatFeature = $derived(autumn.customer?.features?.ai_chat_messages);
	const remainingMessages = $derived(aiChatFeature?.balance ?? 0);
	const hasMessagesAvailable = $derived(remainingMessages > 0);
	const totalMessages = $derived(
		aiChatFeature?.included_usage === 'inf'
			? Infinity
			: typeof aiChatFeature?.included_usage === 'number'
				? aiChatFeature.included_usage
				: 0
	);

	// Thread from URL param
	const threadId = $derived(page.url.searchParams.get('thread') ?? '');

	// Fallback: if navigated to /ai-chat without ?thread= (e.g. direct URL, or the
	// sidebar's unconditional link before a thread exists), get a warm thread.
	// ThreadChat stays unmounted below while this is in flight, since ChatInput
	// has no createThread configured and would otherwise let the user send before
	// there is a thread to send into.
	let resolvingThread = $state(false);
	let resolveThreadBlocked = $state(false);
	let resolveThreadUnblockTimer: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resolution attempt so a stale .then/.catch from an attempt
	// the user has since navigated away from (e.g. picked an existing thread from
	// the sidebar while this was pending) cannot overwrite the newer thread param.
	let resolveGeneration = 0;

	$effect(() => {
		if (!threadId && !resolvingThread && !resolveThreadBlocked && viewer.data) {
			resolvingThread = true;
			const generation = ++resolveGeneration;
			client
				.mutation(api.aiChat.threads.getOrCreateWarmThread, {})
				.then((result) => {
					if (generation !== resolveGeneration || threadId) return;
					const url = new URL(page.url);
					url.searchParams.set('thread', result.threadId);
					goto(resolve(url.pathname + url.search), { noScroll: true, replaceState: true });
				})
				.catch((err) => {
					if (generation !== resolveGeneration) return;
					// Back off instead of retrying at network pace: the effect re-runs
					// when resolvingThread resets while threadId is still empty, so a
					// deterministic failure (e.g. thread-create rate limit) would loop.
					console.error('[ai-chat] Failed to resolve warm thread:', err);
					resolveThreadBlocked = true;
					const retryAfter =
						err instanceof ConvexError
							? ((err.data as { retryAfter?: number })?.retryAfter ?? 60000)
							: 60000;
					resolveThreadUnblockTimer = setTimeout(() => {
						resolveThreadBlocked = false;
					}, retryAfter);
				})
				.finally(() => {
					if (generation === resolveGeneration) resolvingThread = false;
				});
		}
	});

	onDestroy(() => clearTimeout(resolveThreadUnblockTimer));

	async function handleUpgrade() {
		haptic.trigger('light');
		const successUrl = new URL(page.url.href);
		successUrl.searchParams.delete('thread');
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
	title={$t('meta.app.ai_chat.title')}
	description={$t('meta.app.ai_chat.description')}
	noindex
/>

{#if viewer.data}
	<div class="flex h-full flex-col">
		{#if threadId}
			<ThreadChat
				{threadId}
				{isPro}
				{hasMessagesAvailable}
				{remainingMessages}
				{totalMessages}
				onUpgrade={handleUpgrade}
				isUpgrading={upgradeOperation.isLoading}
				onMessageSent={() => autumn.refetch()}
			/>
		{:else}
			<!-- Direct navigation without ?thread=: resolving a warm thread above.
			     ChatInput has no createThread configured, so it must not mount (and
			     accept a send) until threadId exists. -->
			<div class="flex h-full items-center justify-center" role="status">
				<LoaderCircleIcon class="size-5 text-muted-foreground motion-safe:animate-spin" />
				<span class="sr-only">{$t('aria.loading')}</span>
			</div>
		{/if}
	</div>
{/if}
