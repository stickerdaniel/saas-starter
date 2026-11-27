<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type SonnerToaster from './sonner.svelte';

	let Toaster: typeof SonnerToaster | null = $state(null);
	let loading: Promise<void> | undefined;

	async function loadToaster(): Promise<void> {
		try {
			const module = await import('./sonner.svelte');
			Toaster = module.default;
		} catch {
			loading = undefined;
		}
	}

	$effect(() => {
		if (!Toaster && toast.getActiveToasts().length > 0) loading ??= loadToaster();
	});
</script>

{#if Toaster}
	<Toaster />
{/if}
