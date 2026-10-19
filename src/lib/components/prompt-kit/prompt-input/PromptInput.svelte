<script lang="ts">
	import { cn } from '#lib/utils.js';
	import type { Snippet } from 'svelte';
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import {
		PromptInputClass,
		promptInputContext,
		type PromptInputSchema
	} from './prompt-input-context.svelte.ts';

	let {
		class: className,
		isLoading = false,
		value,
		onValueChange,
		maxHeight = 240,
		onSubmit,
		children
	}: PromptInputSchema & {
		class?: string;
		children: Snippet;
	} = $props();

	// Intentionally capture initial values; $effect() syncs updates below.
	// svelte-ignore state_referenced_locally
	const contextInstance = promptInputContext.set(
		new PromptInputClass({
			isLoading,
			value,
			onValueChange,
			maxHeight,
			onSubmit,
			disabled: false
		})
	);

	// Sync props with context
	$effect(() => {
		contextInstance.isLoading = isLoading;
	});

	$effect(() => {
		if (value !== undefined) {
			contextInstance.value = value;
		}
	});

	$effect(() => {
		contextInstance.onValueChange = onValueChange;
	});

	$effect(() => {
		contextInstance.maxHeight = maxHeight;
	});

	$effect(() => {
		contextInstance.onSubmit = onSubmit;
	});

	function handleClick() {
		contextInstance.textareaRef?.focus();
	}
</script>

<!-- No keydown handler: the wrapper is not focusable, so its keys bubble from the
textarea and the actions, and cancelling Enter here swallows Shift+Enter newlines. -->
<TooltipPrimitive.Provider>
	<div
		class={cn('cursor-text rounded-3xl border border-input bg-background p-2 shadow-xs', className)}
		onclick={handleClick}
		role="presentation"
	>
		{@render children()}
	</div>
</TooltipPrimitive.Provider>
