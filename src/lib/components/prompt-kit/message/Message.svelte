<script lang="ts">
	import { cn } from '$lib/utils';
	import { MessageClass, messageContext, type MessageSchema } from './message-context.svelte.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className,
		children,
		...restProps
	}: MessageSchema & {
		class?: string;
		children: Snippet;
	} & HTMLAttributes<HTMLDivElement> = $props();

	messageContext.set(new MessageClass());
</script>

<div class={cn('flex gap-3', className)} {...restProps}>
	{@render children()}
</div>
