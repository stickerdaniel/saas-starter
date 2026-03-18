<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let shouldLoad = $state(false);

	async function openSupport(): Promise<void> {
		const url = new URL(window.location.href);
		url.searchParams.set('support', 'open');
		shouldLoad = true;
		await goto(resolve(`${window.location.pathname}${url.search}`), {
			keepFocus: true,
			noScroll: true
		});
	}

	onMount(() => {
		const currentUrl = new URL(window.location.href);
		if (currentUrl.searchParams.get('support') === 'open') {
			shouldLoad = true;
			return;
		}

		let timeoutId: number | null = null;
		let idleId: number | null = null;
		const { requestIdleCallback, cancelIdleCallback } = window as Window & {
			requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		const interactionEvents: Array<keyof WindowEventMap> = [
			'pointerdown',
			'keydown',
			'scroll',
			'touchstart'
		];

		function loadOnce(): void {
			if (shouldLoad) return;
			shouldLoad = true;
			cleanup();
		}

		function cleanup(): void {
			for (const eventName of interactionEvents) {
				window.removeEventListener(eventName, loadOnce);
			}

			if (idleId !== null && cancelIdleCallback) {
				cancelIdleCallback(idleId);
			}

			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}

		for (const eventName of interactionEvents) {
			window.addEventListener(eventName, loadOnce, { passive: true, once: true });
		}

		if (requestIdleCallback) {
			idleId = requestIdleCallback(loadOnce, { timeout: 3000 });
		} else {
			timeoutId = window.setTimeout(loadOnce, 2000);
		}

		return cleanup;
	});
</script>

{#if shouldLoad}
	{#await import('./customer-support.svelte') then { default: CustomerSupport }}
		<CustomerSupport />
	{/await}
{:else}
	<div class="fixed right-5 bottom-5 z-200 flex items-end justify-end">
		<Button
			variant="default"
			size="icon"
			onclick={openSupport}
			aria-label={$t('aria.feedback_open')}
			class="h-12 w-12 rounded-xl transition-colors transition-transform duration-200 ease-in-out hover:scale-110 hover:bg-primary active:scale-105"
		>
			<div class="-scale-x-100">
				<MessageSquareIcon class="size-6 fill-current" />
			</div>
		</Button>
	</div>
{/if}
