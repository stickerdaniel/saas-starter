<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { ChatAlignment } from './ChatContext.svelte.js';

	let {
		align,
		variant,
		hasTopAttachment = false,
		class: className = '',
		children
	}: {
		/** Alignment - which side the bubble appears on */
		align: ChatAlignment;
		/** Visual variant - filled for user messages, ghost for assistant */
		variant: 'filled' | 'ghost';
		/** Whether there's an attachment above this bubble (affects corner radius) */
		hasTopAttachment?: boolean;
		/** Additional CSS classes */
		class?: string;
		/** Content to render inside the bubble */
		children: Snippet;
	} = $props();

	// Positional styling - mirrors based on alignment
	const cornerClass = $derived(
		hasTopAttachment ? (align === 'right' ? 'rounded-tr-lg' : 'rounded-tl-lg') : ''
	);

	const paddingClass = $derived(
		variant === 'ghost' ? (align === 'left' ? 'pr-[10%]' : 'pl-[10%]') : ''
	);

	// Variant styling - stays constant regardless of alignment
	const variantClasses = $derived(
		variant === 'filled'
			? 'bg-primary/15 px-5 py-2.5 max-w-[85%] md:max-w-[75%] rounded-3xl text-foreground'
			: 'bg-transparent p-0 prose w-full rounded-3xl text-foreground'
	);
</script>

<div class={cn(variantClasses, cornerClass, paddingClass, className)}>
	{@render children()}
</div>
