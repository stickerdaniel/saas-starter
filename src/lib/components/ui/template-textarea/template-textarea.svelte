<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let {
		value = $bindable(''),
		variables,
		class: className,
		rows,
		...restProps
	}: HTMLTextareaAttributes & { value?: string; variables: string[] } = $props();

	let highlightEl: HTMLDivElement | undefined = $state();

	function handleScroll(e: Event) {
		const textarea = e.target as HTMLTextAreaElement;
		if (highlightEl) {
			highlightEl.scrollTop = textarea.scrollTop;
		}
	}

	const varPattern = $derived(new RegExp(`\\{\\{(${variables.join('|')})\\}\\}`, 'g'));

	const highlightedHtml = $derived(
		escapeHtml(value ?? '').replace(
			varPattern,
			'<span class="bg-primary/15 text-primary rounded-sm px-0.5 font-medium">{{$1}}</span>'
		) + '\n' // trailing newline ensures div height matches textarea when last line is full
	);

	function escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
</script>

<div class="relative">
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
			'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base break-words whitespace-pre-wrap shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
			className
		)}
		style="color: transparent; caret-color: var(--color-foreground);"
		bind:value
		{rows}
		oninput={handleScroll}
		onscroll={handleScroll}
		{...restProps}
	></textarea>
</div>
