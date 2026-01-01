<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export interface ConversationProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		children?: Snippet;
		initial?: ScrollBehavior;
		resize?: ScrollBehavior;
	}
</script>

<script lang="ts">
	import { StickToBottomContext, stickToBottomContext } from './stick-to-bottom-context.svelte.js';

	let {
		class: className,
		children,
		initial = 'smooth',
		resize = 'smooth',
		ref = $bindable(null),
		...restProps
	}: ConversationProps = $props();

	let context = stickToBottomContext.set(new StickToBottomContext());
</script>

<div
	bind:this={ref}
	class={cn('relative flex h-full flex-col overflow-hidden', className)}
	role="log"
	{...restProps}
>
	{@render children?.()}
</div>
