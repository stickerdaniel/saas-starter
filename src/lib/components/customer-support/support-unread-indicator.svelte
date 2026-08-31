<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';
	import type { ClassValue } from 'clsx';

	/**
	 * The unread-reply badge. It slides onto its trigger and pops the dot on its
	 * own clock, so the trigger underneath never moves.
	 *
	 * Rendered whatever the state rather than behind an `{#if}`: the close
	 * transition needs the element to still be there once the count reaches zero.
	 */
	let {
		count = 0,
		inline = false,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLSpanElement> & {
		/**
		 * Unread conversations. Zero closes the badge. Omit on a per-conversation
		 * indicator, where a count would be meaningless and the dot stays blank.
		 */
		count?: number;
		/**
		 * Reserve layout space instead of overlaying a trigger. Use in a row that
		 * lays the indicator out in normal flow.
		 */
		inline?: boolean;
	} = $props();

	const open = $derived(count > 0);
	// The query caps its scan one above this, so anything at the cap is "many".
	// The label holds its last real value through the close, because the badge
	// outlives the count that opened it: recomputing it on the way out flashed a
	// red "0" for the length of the collapse.
	let label = $state('');
	// `$effect.pre` and not `$effect`: it runs before the DOM update, so the badge
	// never paints an empty pill on the frame it opens.
	$effect.pre(() => {
		if (count > 0) label = count > 9 ? '9+' : String(count);
	});
</script>

{#snippet badge(badgeClass: ClassValue)}
	<span class={cn('t-badge', badgeClass)} data-open={open} aria-hidden="true" {...restProps}>
		<span
			class={cn(
				't-badge-dot grid place-items-center rounded-full bg-destructive text-white',
				inline ? 'size-2.5' : 'h-4 min-w-4 px-1 text-[10px] leading-none font-medium'
			)}
			data-testid="support-unread-indicator"
		>
			{#if !inline}{label}{/if}
		</span>
	</span>
{/snippet}

{#if inline}
	<!-- The badge is absolutely positioned, so an in-flow use needs a box its own
	     size to sit in or the row closes the gap around it. -->
	<span class={cn('relative inline-block size-2.5 shrink-0', className)}>
		{@render badge('inset-0')}
	</span>
{:else}
	{@render badge(className)}
{/if}
