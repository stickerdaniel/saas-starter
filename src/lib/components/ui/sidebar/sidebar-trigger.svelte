<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import { getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';
	import { useSidebar } from './context.svelte.js';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn('cn-sidebar-trigger', className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		haptic.trigger('light');
		sidebar.toggle();
	}}
	{...restProps}
>
	<PanelLeftIcon />
	<span class="sr-only">{$t('aria.toggle_sidebar')}</span>
</Button>
