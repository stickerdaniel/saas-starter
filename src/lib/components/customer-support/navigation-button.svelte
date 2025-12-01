<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ChevronLeft, X } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	let {
		type,
		onclick,
		class: className
	}: {
		type: 'close' | 'back';
		onclick: () => void;
		class?: string;
	} = $props();
</script>

<Button
	variant="ghost"
	size="icon"
	class={cn('h-10 w-10 shrink-0 rounded-full hover:!bg-muted-foreground/10', className)}
	{onclick}
>
	{#if type === 'back'}
		<ChevronLeft class="size-5" />
	{:else}
		<X class="size-5" />
	{/if}
</Button>
