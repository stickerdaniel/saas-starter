<script lang="ts">
	import { cn } from '$lib/utils';
	import { watch } from 'runed';
	import { chatContainerContext } from './chat-container-context.svelte.ts';

	import type { Snippet } from 'svelte';
	let {
		children,
		class: className,
		...restProps
	}: {
		children?: Snippet;
		class?: string;
		[key: string]: any;
	} = $props();
	const context = chatContainerContext.get();
	let element: HTMLDivElement | null = $state(null);
	watch(
		() => element,
		(value) => {
			context.setContentElement(value);
			return () => context.setContentElement(null);
		}
	);
</script>

<div
	bind:this={element}
	class={cn('flex min-h-full w-full shrink-0 flex-col', className)}
	{...restProps}
>
	{@render children?.()}
</div>
