<script lang="ts">
	import { cn } from '$lib/utils';
	import Textarea from '$lib/components/ui/textarea/textarea.svelte';
	import { promptInputContext } from './prompt-input-context.svelte.ts';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { watch } from 'runed';

	type Props = HTMLTextareaAttributes & {
		/**
		 * `full` and `compact` are the chat composers, `chatbar` the support pill. Compact
		 * pads a wrapped field more than a single line and masks it while it scrolls.
		 */
		layout?: 'default' | 'full' | 'compact' | 'chatbar';
		multiline?: boolean;
		scrollMask?: boolean;
	};

	let {
		class: className,
		layout = 'default',
		multiline = false,
		scrollMask = false,
		onkeydown,
		onpaste,
		...restProps
	}: Props = $props();

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

<!-- `placeholder-shown` keeps the clipping to the empty field: a placeholder that
wraps swells the pill at narrow widths, while typed content is meant to wrap and
grow the field. -->
<Textarea
	bind:ref={context.textareaRef}
	value={context.value}
	oninput={handleInput}
	onkeydown={handleKeyDown}
	{onpaste}
	resize="none"
	class={cn(
		'min-h-11 w-full border-none !bg-transparent text-foreground shadow-none outline-none placeholder-shown:overflow-hidden placeholder-shown:whitespace-nowrap focus-visible:ring-0 focus-visible:ring-offset-0',
		layout === 'full' && 'min-h-11 pt-3 pl-4 text-base leading-composer',
		layout === 'compact' && 'min-h-9 py-2 text-base leading-5',
		layout === 'compact' && (multiline ? 'pr-2 pl-3' : 'px-1'),
		layout === 'compact' && scrollMask && 'composer-scroll-mask',
		layout === 'chatbar' && '!h-auto !min-h-auto rounded-full bg-transparent !py-0',
		className,
		'max-h-(--prompt-max-height)'
	)}
	style="--prompt-max-height: {maxHeightStyle}"
	rows={1}
	disabled={context.disabled}
	{...restProps}
></Textarea>
