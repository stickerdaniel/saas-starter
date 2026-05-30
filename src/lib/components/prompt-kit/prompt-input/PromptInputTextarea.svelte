<script lang="ts">
	import { cn } from '$lib/utils';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import { promptInputContext } from './prompt-input-context.svelte.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { watch } from 'runed';

	let {
		class: className,
		onkeydown,
		onpaste,
		disableAutosize = false,
		...restProps
	}: HTMLTextareaAttributes & {
		disableAutosize?: boolean;
	} = $props();

	const context = promptInputContext.get();

	// Auto-resize. Always reset to `auto` before measuring so the textarea can
	// shrink as well as grow: the earlier `scrollTop === 0` guard skipped the
	// reset while the field was scrolled, which left it stuck at a tall height.
	function resize() {
		if (disableAutosize) return;
		const ta = context.textareaRef;
		if (!ta) return;
		ta.style.height = 'auto';
		ta.style.height =
			typeof context.maxHeight === 'number'
				? `${Math.min(ta.scrollHeight, context.maxHeight)}px`
				: `min(${ta.scrollHeight}px, ${context.maxHeight})`;
	}

	// Re-measure on value/maxHeight changes...
	watch([() => context.value, () => context.maxHeight, () => disableAutosize], resize);

	// ...and on width changes. scrollHeight is width-dependent, so a height
	// measured while the field was narrow (e.g. the empty placeholder wrapping in
	// a resizable pane) is a fixed pixel value that would otherwise never recover
	// when the field widens again. A ResizeObserver re-runs the measurement so the
	// height tracks the current width instead of latching.
	$effect(() => {
		const ta = context.textareaRef;
		if (!ta || disableAutosize || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => resize());
		observer.observe(ta);
		return () => observer.disconnect();
	});

	function handleKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			context.onSubmit?.();
		}
		onkeydown?.(e);
	}

	function handleInput(e: Event & { currentTarget: HTMLTextAreaElement }) {
		context.setValue(e.currentTarget.value);
	}
</script>

<Textarea
	bind:ref={context.textareaRef}
	value={context.value}
	oninput={handleInput}
	onkeydown={handleKeyDown}
	{onpaste}
	class={cn(
		'min-h-[44px] w-full resize-none border-none !bg-transparent text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
		className
	)}
	rows={1}
	disabled={context.disabled}
	{...restProps}
></Textarea>
