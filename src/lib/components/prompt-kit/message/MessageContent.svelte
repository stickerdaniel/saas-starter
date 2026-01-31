<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		markdown = false,
		class: className,
		content,
		children,
		...restProps
	}: {
		content?: string;
		markdown?: boolean;
		class?: string;
		children?: Snippet;
	} & HTMLAttributes<HTMLDivElement> = $props();

	let classNames = $derived(
		cn('text-foreground bg-secondary prose rounded-lg p-2 break-words whitespace-normal', className)
	);
</script>

{#if markdown && content}
	{#await import('../markdown/Markdown.svelte') then { default: Markdown }}
		<Markdown class={classNames} {content}></Markdown>
	{/await}
{:else}
	<div class={classNames} {...restProps}>
		{@render children?.()}
	</div>
{/if}
