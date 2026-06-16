<script lang="ts">
	import { Head } from '@better-svelte-email/components';
	import type { Snippet } from 'svelte';

	let { children }: { children?: Snippet } = $props();

	// Self-host the Outfit brand sans inside the email <head>. The email build
	// inlines font-sans on <Body> as font-family:'Outfit', so without an
	// @font-face the brand font is referenced but never loads, and clients fall
	// back to system sans. We inject the rules as a raw string via {@html}
	// because a Svelte <style> block compiles to scoped component CSS and never
	// reaches the head. mso-* hints keep Outlook Windows on a sans fallback
	// (it can't load woff2) instead of dropping to Times New Roman. WebKit
	// clients (Apple Mail, iOS) load the woff2 and render the brand font;
	// everything else keeps the existing system-sans fallback in the stack.
	const fontFaceStyle = `<style>
@font-face{font-family:'Outfit';font-style:normal;font-weight:400;font-display:swap;src:url('__BASEURL__/fonts/outfit-v15-latin-regular.woff2') format('woff2');mso-generic-font-family:sans-serif;mso-font-alt:'Arial';}
@font-face{font-family:'Outfit';font-style:normal;font-weight:500;font-display:swap;src:url('__BASEURL__/fonts/outfit-v15-latin-500.woff2') format('woff2');mso-generic-font-family:sans-serif;mso-font-alt:'Arial';}
@font-face{font-family:'Outfit';font-style:normal;font-weight:600;font-display:swap;src:url('__BASEURL__/fonts/outfit-v15-latin-600.woff2') format('woff2');mso-generic-font-family:sans-serif;mso-font-alt:'Arial';}
</style>`;
</script>

<Head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- hardcoded constant, no user input -->
	{@html fontFaceStyle}{@render children?.()}
</Head>
