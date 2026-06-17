<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export interface ConversationContentProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { stickToBottomContext } from './stick-to-bottom-context.svelte.js';
	import { watch } from 'runed';

	let {
		class: className,
		children,
		ref = $bindable(null),
		...restProps
	}: ConversationContentProps = $props();

	const context = stickToBottomContext.get();

	watch(
		() => ref,
		() => {
			if (ref) {
				context.setElement(ref);
				// Initial scroll to bottom
				context.scrollToBottom('smooth');
			}
		}
	);
</script>

<div bind:this={ref} class={cn('flex-1 overflow-y-auto p-4', className)} {...restProps}>
	{@render children?.()}
</div>
