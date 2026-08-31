<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	/**
	 * Cross-fades two icons through blur and scale in a single grid cell.
	 *
	 * Both icons stay mounted: an `{#if}/{:else}` destroys the outgoing one, so
	 * there is nothing left to fade out and the swap reads as a hard cut. The
	 * accessible name belongs on the surrounding control, not here.
	 */
	let {
		showSecond,
		first,
		second,
		class: className
	}: {
		showSecond: boolean;
		first: Snippet;
		second: Snippet;
		class?: string;
	} = $props();
</script>

<span class={cn('t-icon-swap', className)} data-state={showSecond ? 'b' : 'a'}>
	<span class="t-icon" data-icon="a" aria-hidden={showSecond}>{@render first()}</span>
	<span class="t-icon" data-icon="b" aria-hidden={!showSecond}>{@render second()}</span>
</span>
