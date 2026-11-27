<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type SonnerToaster from './sonner.svelte';

	let Toaster: typeof SonnerToaster | null = $state(null);
	let loading: Promise<void> | undefined;

	function load(): Promise<void> {
		loading ??= loadToaster();
		return loading;
	}

	async function loadToaster(): Promise<void> {
		try {
			const module = await import('./sonner.svelte');
			Toaster = module.default;
		} catch {
			loading = undefined;
		}
	}

	onMount(() => {
		let cancelIdle = () => {};
		const preloadWhenIdle = () => {
			if ('requestIdleCallback' in window) {
				const id = requestIdleCallback(() => void load());
				cancelIdle = () => cancelIdleCallback(id);
			} else {
				const id = setTimeout(() => void load());
				cancelIdle = () => clearTimeout(id);
			}
		};
		if (document.readyState === 'complete') preloadWhenIdle();
		else window.addEventListener('load', preloadWhenIdle, { once: true });
		return () => {
			window.removeEventListener('load', preloadWhenIdle);
			cancelIdle();
		};
	});

	$effect(() => {
		if (!Toaster && toast.getActiveToasts().length > 0) void load();
	});
</script>

{#if Toaster}
	<Toaster />
{/if}
