<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	import { mode } from '#lib/theme.svelte.ts';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	// Toasts wait while the tab is hidden, so a result that lands in a background
	// tab is still there when the user comes back. Callers cannot turn that off.
	let { ...restProps }: Omit<SonnerProps, 'pauseWhenPageIsHidden'> = $props();
</script>

<Sonner
	theme={mode.current}
	class="toaster group selectable"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
	pauseWhenPageIsHidden
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 motion-safe:animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>

<style>
	/* Keeps the toaster in place under a Bits UI scroll lock, like scroll-lock-inset.
	   Sonner sets margin: 0 and, at its 600 px breakpoint, width: 100% from unlayered
	   CSS, so the class selector raises specificity above it. */
	:global([data-sonner-toaster].toaster) {
		margin-right: var(--scrollbar-width, 0px);
	}
	@media (max-width: 600px) {
		:global([data-sonner-toaster].toaster) {
			width: calc(100% - var(--scrollbar-width, 0px));
		}
	}
</style>
