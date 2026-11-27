<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type SonnerToaster from './sonner.svelte';
	import { toasterStatus } from './toaster-status.svelte.ts';

	let Toaster: typeof SonnerToaster | null = $state(null);
	let loading: Promise<void> | undefined;

	async function loadToaster(): Promise<void> {
		try {
			const module = await import('./sonner.svelte');
			Toaster = module.default;
			toasterStatus.failed = false;
		} catch {
			loading = undefined;
			toasterStatus.failed = true;
		}
	}

	const activeToasts = $derived(toast.getActiveToasts().length);

	$effect(() => {
		if (!Toaster && activeToasts > 0) loading ??= loadToaster();
	});
</script>

{#if Toaster}
	<Toaster />
{/if}
