<script lang="ts">
	import { T } from '@tolgee/svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';

	let {
		groupKey,
		labelKey,
		open = true,
		onOpenChange,
		children,
		testId
	}: {
		groupKey: string;
		labelKey: string;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		children: Snippet;
		testId?: string;
	} = $props();

	const resolvedTestId = $derived(testId ?? `collapsible-group-${groupKey}`);

	function toggle() {
		const next = !open;
		onOpenChange?.(next);
	}
</script>

<div data-testid={resolvedTestId} class="rounded-lg border">
	<button
		type="button"
		class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50"
		onclick={toggle}
		aria-expanded={open}
		data-testid={`${resolvedTestId}-trigger`}
	>
		<span
			class="inline-flex shrink-0 transition-transform duration-200"
			style:transform={open ? 'rotate(90deg)' : undefined}
		>
			<ChevronRightIcon class="size-4 text-muted-foreground" />
		</span>
		<T keyName={labelKey} />
	</button>
	<div class="collapsible-grid-wrapper" style:grid-template-rows={open ? '1fr' : '0fr'}>
		<div class="overflow-hidden">
			<div class="px-4 pb-4">
				{@render children()}
			</div>
		</div>
	</div>
</div>

<style>
	.collapsible-grid-wrapper {
		display: grid;
		transition: grid-template-rows 200ms ease;
	}
</style>
