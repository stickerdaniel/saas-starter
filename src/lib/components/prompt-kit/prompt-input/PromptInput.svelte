<script lang="ts">
	import { cn } from '$lib/utils';
	import { Tooltip as TooltipPrimitive } from 'bits-ui';
	import {
		PromptInputClass,
		promptInputContext,
		type PromptInputSchema
	} from './prompt-input-context.svelte.js';

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
		children: import('svelte').Snippet;
	} = $props();

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

	function handleKeyDown(e: KeyboardEvent) {
		// Don't intercept Enter from buttons or other interactive elements
		const target = e.target as HTMLElement;
		if (target.closest('button, a, [role="button"]')) {
			return;
		}

		// Only handle Enter key to focus textarea from wrapper
		if (e.key === 'Enter') {
			e.preventDefault();
			handleClick();
		}
	}
</script>

<TooltipPrimitive.Provider>
	<div
		class={cn('cursor-text rounded-3xl border border-input bg-background p-2 shadow-xs', className)}
		onclick={handleClick}
		onkeydown={handleKeyDown}
		role="button"
		tabindex="-1"
	>
		{@render children()}
	</div>
</TooltipPrimitive.Provider>
