<script lang="ts">
	import { slide, fade } from 'svelte/transition';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		errors,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		children?: Snippet;
		errors?: { message?: string }[];
	} = $props();

	const errorMessages = $derived(
		errors?.map((e) => e?.message).filter((m): m is string => !!m) ?? []
	);
	const hasContent = $derived(children || errorMessages.length > 0);
</script>

{#if hasContent}
	<div
		bind:this={ref}
		role="alert"
		data-slot="field-error"
		transition:slide={{ duration: 200 }}
		class={cn('text-sm font-normal text-destructive', className)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{:else}
			<div class="grid">
				{#key errorMessages.join('\x00')}
					<ul
						class={cn(
							'col-start-1 row-start-1',
							errorMessages.length > 1 ? 'ml-4 list-disc space-y-1' : 'list-none'
						)}
						in:fade={{ duration: 150, delay: 100 }}
						out:fade={{ duration: 100 }}
					>
						{#each errorMessages as message (message)}
							<li>{message}</li>
						{/each}
					</ul>
				{/key}
			</div>
		{/if}
	</div>
{/if}
