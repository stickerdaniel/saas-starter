<script lang="ts">
	import { cn } from '#lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		ref = $bindable(null),
		variables,
		variant = 'default',
		class: className,
		rows,
		...restProps
	}: HTMLTextareaAttributes & {
		value?: string;
		ref?: HTMLTextAreaElement | null;
		variables: string[];
		/** `embedded` drops the field frame for an editor that draws its own. */
		variant?: 'default' | 'embedded';
	} = $props();

	let highlightEl: HTMLDivElement | undefined = $state();

	function handleScroll(e: Event) {
		const textarea = e.target as HTMLTextAreaElement;
		if (highlightEl) {
			highlightEl.scrollTop = textarea.scrollTop;
		}
	}

	const varPattern = $derived(new RegExp(`\\{\\{(${variables.join('|')})\\}\\}`, 'g'));

	// The textarea draws the caret and selection from its own plain text, so a mark must
	// keep every glyph where the textarea puts it: the negative margin cancels the
	// padding, and the weight stays regular because bolder glyphs are wider.
	const highlightedHtml = $derived(
		escapeHtml(value ?? '').replace(
			varPattern,
			'<span class="bg-primary/15 text-primary -mx-0.5 rounded-sm px-0.5">{{$1}}</span>'
		) + '\n' // trailing newline ensures div height matches textarea when last line is full
	);

	function escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
</script>

<div class="relative w-full">
	<!-- Highlight layer (behind textarea) -->
	<div
		bind:this={highlightEl}
		aria-hidden="true"
		class={cn(
			'pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 text-base break-words whitespace-pre-wrap md:text-sm',
			className
		)}
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- Content is HTML-escaped before injection; admin-only input -->
		{@html highlightedHtml}
	</div>

	<!-- Transparent textarea (on top, receives input) -->
	<textarea
		class={cn(
			'flex field-sizing-content min-h-16 w-full rounded-md border border-transparent bg-transparent px-3 py-2 text-base break-words whitespace-pre-wrap outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
			variant === 'default' &&
				'border-input shadow-xs transition-field-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
			className,
			'text-transparent caret-foreground'
		)}
		bind:this={ref}
		bind:value
		{rows}
		oninput={handleScroll}
		onscroll={handleScroll}
		{...restProps}></textarea>
</div>
