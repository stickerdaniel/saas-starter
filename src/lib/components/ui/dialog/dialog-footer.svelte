<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
	} = $props();
</script>

<!--
	Deviates from the shadcn-svelte registry default: this footer bleeds to the card
	edge with a tinted bar instead of sitting inside the dialog padding. The negative
	margins must cancel Dialog.Content's padding exactly, so both read --dialog-inset.
	A `shadcn-svelte` update will overwrite this file; reapply the bleed afterwards.
-->
<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn(
		'-mx-(--dialog-inset) -mb-(--dialog-inset) flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 px-(--dialog-inset) py-4 sm:flex-row sm:justify-end',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="outline" {...props}>{$t('aria.close')}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
