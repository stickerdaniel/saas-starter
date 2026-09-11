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

	// Apple Mail on iOS and macOS never enters dark mode without both of these
	// meta tags; it renders the message on a pure white page instead. They also
	// switch Apple into a partial auto-invert that darkens the card but leaves
	// light boxes light, so they must not ship without the dark: utilities on the
	// shared email components. Same {@html} reason as above: the rules belong in
	// the real <head>, and a Svelte <style> block never gets there.
	//
	// <body> needs a hand-written rule because better-svelte-email puts the Body
	// class on the wrapping <td>, leaving <body> with the background the app's
	// `body { @apply bg-background }` base rule inlines. The rule is nested inside
	// its selector on purpose, matching what the compiler emits for dark:
	// utilities: Outlook ignores CSS nesting and keeps its own inversion, where a
	// flat @media block flattens the layout into one surface. Colours mirror the
	// .dark block in src/routes/layout.css (zinc-950 page, zinc-50 foreground).
	const colorSchemeStyle = `<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
body{@media (prefers-color-scheme:dark){background-color:#09090b!important;color:#fafafa!important;}}
</style>`;
</script>

<Head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- hardcoded constants, no user input -->
	{@html `${colorSchemeStyle}${fontFaceStyle}`}{@render children?.()}
</Head>
