<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import type { DocsNavSection } from '#lib/docs/navigation.js';
	import type { DocsHeaderLink } from './docs-header.svelte';
	import DocsMobileLinks from './docs-mobile-links.svelte';
	import type { LazyMenuProps } from './lazy-menu.svelte.ts';

	let {
		open = $bindable(false),
		trigger = $bindable(null),
		button,
		links,
		sections,
		currentSlug,
		lang
	}: LazyMenuProps & {
		button: Snippet<[Record<string, unknown>]>;
		links: readonly DocsHeaderLink[];
		sections: readonly DocsNavSection[];
		currentSlug: string;
		lang: string;
	} = $props();
</script>

<Popover.Root bind:open>
	<Popover.Trigger bind:ref={trigger}>
		{#snippet child({ props })}
			{@render button(props)}
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<!-- The full-bleed menu needs the bare primitive: Popover.Content draws a card, and the popover lint forbids the class overrides the shadcn-svelte docs use. -->
		<PopoverPrimitive.Content
			align="start"
			side="bottom"
			alignOffset={-16}
			sideOffset={14}
			preventScroll
			class="docs-mobile-menu z-50 no-scrollbar overflow-y-auto bg-background text-foreground outline-hidden"
		>
			<DocsMobileLinks {links} {sections} {currentSlug} {lang} onnavigate={() => (open = false)} />
		</PopoverPrimitive.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	:global(.docs-mobile-menu) {
		width: var(--bits-popover-content-available-width);
		height: var(--bits-popover-content-available-height);
	}
</style>
