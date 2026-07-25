<script lang="ts">
	import { cn } from '$lib/utils';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import { promptInputContext } from './prompt-input-context.svelte.ts';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { watch } from 'runed';

	let { class: className, onkeydown, onpaste, ...restProps }: HTMLTextareaAttributes = $props();

	const context = promptInputContext.get();

	// The base Textarea carries `field-sizing-content`, so engines that support
	// it grow and shrink the field with its content — including re-wrapping on
	// width changes — without any JS measurement. The context maxHeight becomes
	// a plain CSS clamp below. Engines without field-sizing (Safari, Firefox)
	// fall back to the previous JS autosize.
	const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

	// Fallback auto-resize. Always reset to `auto` before measuring so the
	// textarea can shrink as well as grow.
	function resize() {
		if (supportsFieldSizing) return;
		const ta = context.textareaRef;
		if (!ta) return;
		ta.style.height = 'auto';
		ta.style.height =
			typeof context.maxHeight === 'number'
				? `${Math.min(ta.scrollHeight, context.maxHeight)}px`
				: `min(${ta.scrollHeight}px, ${context.maxHeight})`;
	}

	// Re-measure on value/maxHeight changes...
	watch([() => context.value, () => context.maxHeight], resize);

	// ...and on width changes. scrollHeight is width-dependent, so a height
	// measured while the field was narrow is a fixed pixel value that would
	// otherwise never recover when the field widens again.
	$effect(() => {
		const ta = context.textareaRef;
		if (!ta || supportsFieldSizing || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => resize());
		observer.observe(ta);
		return () => observer.disconnect();
	});

	const maxHeightStyle = $derived(
		typeof context.maxHeight === 'number' ? `${context.maxHeight}px` : context.maxHeight
	);

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
	style="max-height: {maxHeightStyle}"
	rows={1}
	disabled={context.disabled}
	{...restProps}
></Textarea>
