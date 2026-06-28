<script lang="ts">
	import type { IconProps } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	// Inlined at build time from the single logo source (static/logo.svg), the same
	// file that feeds favicon/PWA/email generation. Shipping the mark in the HTML
	// payload avoids the runtime fetch of a CSS mask-image, which left the mark
	// blank on first paint until /logo.svg loaded over the network. Trusted local
	// build-time constant, so {@html} carries no injection risk.
	import logoSvg from '$static/logo.svg?raw';

	// Accept IconProps for compatibility with LucideIcon type, but only use class
	let { class: className }: IconProps = $props();
</script>

<!-- The source SVG strokes in currentColor; text-[var(--logo-color,currentColor)]
     preserves the optional --logo-color override the mask version exposed. -->
<span
	class={cn('logo-mark inline-block text-[var(--logo-color,currentColor)]', className)}
	aria-hidden="true"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- Trusted build-time constant inlined from static/logo.svg, no user input -->
	{@html logoSvg}
</span>

<style>
	/* The inlined SVG ships with width/height="24"; pin it to the wrapper box
	   (sized via the size-* utility on .logo-mark) so the mark renders at exactly
	   the dimensions the old mask-size:contain produced. Scoped to the component
	   instead of a Tailwind [&>svg] variant so the sizing is atomic with the
	   markup and can never momentarily fall back to the SVG's intrinsic 24px
	   while JIT CSS catches up. */
	.logo-mark > :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
