<script lang="ts">
	import { fileUploadContext } from './file-upload-context.svelte';
	import type { Snippet } from 'svelte';
	import { IsMounted } from 'runed';
	import { cn } from '$lib/utils';

	type Props = {
		class?: string;
		children?: Snippet;
		[key: string]: any;
	};

	let { class: className, children, ...restProps }: Props = $props();

	const context = fileUploadContext.get();
	const mounted = new IsMounted();

	const shouldRender = $derived(context?.isDragging && mounted.current && !context?.disabled);
</script>

{#if shouldRender}
	<div
		class={cn(
			'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm',
			'animate-in duration-150 fade-in-0 slide-in-from-bottom-10 zoom-in-90',
			className
		)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
