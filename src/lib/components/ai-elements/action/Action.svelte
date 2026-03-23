<script lang="ts">
	import { cn } from '$lib/utils';
	import {
		buttonVariants,
		type ButtonVariant,
		type ButtonSize
	} from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithChildren, WithoutChildren } from 'bits-ui';
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip/index.js';

	type ActionButtonAttrs = WithoutChildren<Omit<HTMLButtonAttributes, 'type'>>;

	export type ActionProps = WithChildren<ActionButtonAttrs> & {
		tooltip?: string;
		label?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLButtonElement | null;
	};

	let {
		tooltip,
		children,
		label,
		class: className,
		variant = 'ghost',
		size = 'sm',
		...restProps
	}: ActionProps = $props();

	let buttonClasses = $derived(
		cn('text-muted-foreground hover:text-foreground relative size-9 p-1.5', className)
	);
	let buttonProps = $derived(restProps as ActionButtonAttrs);
</script>

{#if tooltip}
	<TooltipProvider>
		<Tooltip delayDuration={150}>
			<TooltipTrigger>
				<button
					class={cn(buttonVariants({ variant, size }), buttonClasses)}
					type="button"
					{...buttonProps}
				>
					{@render children?.()}
					<span class="sr-only">{label || tooltip}</span>
				</button>
			</TooltipTrigger>
			<TooltipContent>
				<p>{tooltip}</p>
			</TooltipContent>
		</Tooltip>
	</TooltipProvider>
{:else}
	<button
		class={cn(buttonVariants({ variant, size }), buttonClasses)}
		type="button"
		{...buttonProps}
	>
		{@render children?.()}
		<span class="sr-only">{label || tooltip}</span>
	</button>
{/if}
