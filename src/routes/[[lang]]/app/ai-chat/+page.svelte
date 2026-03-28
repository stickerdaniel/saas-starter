<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { useCustomer, useAutumnOperation } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import ThreadChat from './thread-chat.svelte';

	const { t } = getTranslate();

	let { data } = $props();

	const client = useConvexClient();

	// Auth
	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));

	// Pro check
	const autumn = useCustomer();
	const upgradeOperation = useAutumnOperation(autumn.checkout);
	const isPro = $derived(autumn.customer?.products?.some((p) => p.id === 'pro') ?? false);

	// Thread from URL param
	const threadId = $derived(page.url.searchParams.get('thread') ?? '');

	// Fallback: if navigated to /ai-chat without ?thread= (e.g. direct URL), get warm thread.
	// The common path (sidebar click) already includes ?thread=warmId, so this rarely fires.
	let resolvingThread = $state(false);

	$effect(() => {
		if (!threadId && !resolvingThread && viewer.data) {
			resolvingThread = true;
			client
				.mutation(api.aiChat.threads.getOrCreateWarmThread, {})
				.then((result) => {
					const url = new URL(page.url);
					url.searchParams.set('thread', result.threadId);
					goto(resolve(url.pathname + url.search), { noScroll: true, replaceState: true });
				})
				.catch((err) => {
					console.error('[ai-chat] Failed to resolve warm thread:', err);
				})
				.finally(() => {
					resolvingThread = false;
				});
		}
	});

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
		}
	}
</script>

<SEOHead title={$t('meta.app.ai_chat.title')} description={$t('meta.app.ai_chat.description')} />

{#if viewer.data}
	<div class="flex h-full flex-col">
		<ThreadChat
			{threadId}
			{isPro}
			onUpgrade={handleUpgrade}
			isUpgrading={upgradeOperation.isLoading}
		/>
	</div>
{/if}
