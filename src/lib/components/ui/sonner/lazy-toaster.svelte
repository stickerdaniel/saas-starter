<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type SonnerToaster from './sonner.svelte';
	import ToastFallback from './toast-fallback.svelte';

	let Toaster: typeof SonnerToaster | null = $state(null);
	let failed = $state(false);
	let loading: Promise<void> | undefined;

	async function loadToaster(): Promise<void> {
		try {
			const module = await import('./sonner.svelte');
			Toaster = module.default;
		} catch {
			loading = undefined;
			failed = true;
		}
	}

	const activeToasts = $derived(toast.getActiveToasts().length);

	$effect(() => {
		if (!Toaster && activeToasts > 0) loading ??= loadToaster();
	});
</script>

{#if Toaster}
	<Toaster />
{:else if failed}
	<ToastFallback />
{/if}
