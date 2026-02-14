<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { getTranslate } from '@tolgee/svelte';
	import { cn } from '$lib/utils.js';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import { sidebarContext } from './context.svelte.js';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: {
		ref?: HTMLButtonElement | null;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		[key: string]: any;
	} = $props();

	const sidebar = sidebarContext.get();
</script>

<Button
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon"
	class={cn('size-7', className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<PanelLeftIcon />
	<span class="sr-only">{$t('aria.toggle_sidebar')}</span>
</Button>
