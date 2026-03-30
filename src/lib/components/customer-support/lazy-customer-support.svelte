<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import { getTranslate } from '@tolgee/svelte';
	import type { Component } from 'svelte';

	const { t } = getTranslate();

	let isLoading = $state(false);
	let CustomerSupport: Component | null = $state(null);

	async function preload(): Promise<void> {
		if (CustomerSupport) return;
		const mod = await import('./customer-support.svelte');
		CustomerSupport = mod.default;
	}

	async function openSupport(): Promise<void> {
		isLoading = true;
		try {
			await preload();
		} finally {
			isLoading = false;
		}
		if (!CustomerSupport) return;
		const url = new URL(window.location.href);
		url.searchParams.set('support', 'open');
		await goto(resolve(`${window.location.pathname}${url.search}`), {
			keepFocus: true,
			noScroll: true
		});
	}

	onMount(() => {
		const currentUrl = new URL(window.location.href);
		if (currentUrl.searchParams.get('support') === 'open') {
			preload();
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

		function preloadOnce(): void {
			if (CustomerSupport) return;
			preload();
			cleanup();
		}

		function cleanup(): void {
			for (const eventName of interactionEvents) {
				window.removeEventListener(eventName, preloadOnce);
			}

			if (idleId !== null && cancelIdleCallback) {
				cancelIdleCallback(idleId);
			}

			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}

		for (const eventName of interactionEvents) {
			window.addEventListener(eventName, preloadOnce, { passive: true, once: true });
		}

		if (requestIdleCallback) {
			idleId = requestIdleCallback(preloadOnce, { timeout: 3000 });
		} else {
			timeoutId = window.setTimeout(preloadOnce, 2000);
		}

		return cleanup;
	});
</script>

{#if CustomerSupport}
	<CustomerSupport />
{:else}
	<div class="fixed right-5 bottom-5 z-200 flex items-end justify-end">
		<Button
			variant="default"
			size="icon"
			disabled={isLoading}
			onclick={openSupport}
			aria-label={$t('aria.feedback_open')}
			class="h-12 w-12 rounded-xl transition-[color,background-color,border-color,transform] duration-200 ease-out hover:scale-105 hover:bg-primary active:scale-[0.97]"
		>
			<div class="-scale-x-100">
				<MessageSquareIcon class="size-6 fill-current" />
			</div>
		</Button>
	</div>
{/if}
