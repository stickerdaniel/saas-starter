<script lang="ts">
	import { cn } from '$lib/utils';

	import type { Snippet } from 'svelte';
	interface Props {
		class?: string;
		children?: Snippet;
	}

	let { class: className, children, ...props }: Props = $props();
</script>

<div class={cn('flex items-center justify-between p-1', className)} {...props}>
	{#if children}
		{@render children()}
	{/if}
</div>
