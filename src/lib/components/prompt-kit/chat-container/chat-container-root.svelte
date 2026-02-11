<script lang="ts">
	import {
		ChatContainerContext,
		chatContainerContext,
		type ResizeMode,
		type InitialMode
	} from './chat-container-context.svelte';
	import { cn } from '$lib/utils';
	import { watch } from 'runed';

	let {
		children,
		class: className,
		resize = 'smooth',
		initial = 'instant',
		ref = $bindable(null),
		...restProps
	}: {
		children?: import('svelte').Snippet;
		class?: string;
		resize?: ResizeMode;
		initial?: InitialMode;
		ref?: HTMLElement | null;
		[key: string]: any;
	} = $props();

	const context = chatContainerContext.set(new ChatContainerContext());
	$effect(() => {
		context.setModes(resize, initial);
	});

	watch(
		() => ref,
		() => {
			if (ref) {
				context.setElement(ref);
			}
		}
	);
</script>

<div
	bind:this={ref}
	class={cn(' scrollbar-thin flex flex-col overflow-y-auto', className)}
	role="log"
	{...restProps}
>
	{@render children?.()}
</div>
