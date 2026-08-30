<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	data-slot="checkbox"
	class={cn(
		't-check [--check-len:23] peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary',
		className
	)}
	bind:checked
	bind:indeterminate
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<div
			data-slot="checkbox-indicator"
			class="grid place-content-center text-current transition-none [&>svg]:size-3.5"
		>
			<!-- The tick stays mounted whatever the state: it draws itself through
			     stroke-dashoffset (`.t-check` in layout.css), and a path that mounts
			     already checked has no offset left to animate from. While unchecked
			     the dash offset covers the whole stroke, so nothing paints.
			     `--check-len` is lucide's own `check` path length (M20 6 9 17l-5-5,
			     so √242 + √50 = 22.63 user units) rounded up by one, as the recipe
			     requires: shorter pre-reveals the tick, longer leaves it unfinished.
			     Re-measure if the icon is ever swapped. -->
			<CheckIcon class="col-start-1 row-start-1" />
			{#if indeterminate && !checked}
				<MinusIcon class="col-start-1 row-start-1" />
			{/if}
		</div>
	{/snippet}
</CheckboxPrimitive.Root>
