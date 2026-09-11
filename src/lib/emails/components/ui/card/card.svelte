<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		children?: Snippet;
	} = $props();
</script>

<!--
	Emails cannot resolve the theme tokens, because the `.dark` class that
	redefines them never exists in a mail client, so every dark: utility across
	these components names a zinc step directly. The steps are the ones the .dark
	block in src/routes/layout.css resolves to: zinc-900 card, zinc-800 border and
	muted surfaces, zinc-50 foreground, zinc-400 muted foreground.
-->
<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		'rounded-xl border bg-card py-6 text-card-foreground shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
