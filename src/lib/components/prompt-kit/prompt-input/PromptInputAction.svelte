<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { Snippet } from 'svelte';
	import { promptInputContext } from './prompt-input-context.svelte.js';

	let {
		tooltip,
		children,
		class: className,
		side = 'top'
	}: {
		tooltip?: Snippet;
		children: Snippet<[Record<string, unknown>]>;
		class?: string;
		side?: 'top' | 'bottom' | 'left' | 'right';
	} = $props();

	const context = promptInputContext.get();
</script>

{#if tooltip}
	<Tooltip.Root>
		<Tooltip.Trigger disabled={context.disabled}>
			{#snippet child({ props })}
				{@render children(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content {side} class="z-250 {className}">
			{@render tooltip()}
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	{@render children({})}
{/if}
