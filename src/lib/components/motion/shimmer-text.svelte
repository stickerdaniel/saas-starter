<script lang="ts">
	import { cn } from '$lib/utils.js';

	/**
	 * A label that sweeps a highlight band across itself while some work runs.
	 *
	 * The transition duplicates the string into `data-text` so a `::before`
	 * layer can clip a moving gradient to the same glyphs, which is why the
	 * text is a prop rather than a snippet: the two copies have to stay
	 * identical or the shimmer traces the wrong shape.
	 */
	let { text, class: className }: { text: string; class?: string } = $props();
</script>

<span class={cn('t-shimmer', className)} data-text={text}>{text}</span>
