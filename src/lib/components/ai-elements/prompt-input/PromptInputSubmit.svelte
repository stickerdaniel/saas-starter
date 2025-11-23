<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import type {
		ButtonPropsWithoutHTML,
		ButtonVariant,
		ButtonSize
	} from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithoutChildren } from 'bits-ui';
	import type { ChatStatus } from './attachments-context.svelte.js';
	import SendIcon from './SendIcon.svelte';
	import Loader2Icon from './Loader2Icon.svelte';
	import SquareIcon from './SquareIcon.svelte';
	import XIcon from './XIcon.svelte';

	type Props = ButtonPropsWithoutHTML &
		WithoutChildren<Omit<HTMLButtonAttributes, 'type'>> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			status?: ChatStatus;
		};

	let {
		class: className,
		variant = 'default',
		size = 'icon',
		status,
		children,
		...props
	}: Props = $props();

	let Icon = $derived.by(() => {
		if (status === 'submitted') {
			return Loader2Icon;
		} else if (status === 'streaming') {
			return SquareIcon;
		} else if (status === 'error') {
			return XIcon;
		}
		return SendIcon;
	});

	let iconClass = $derived.by(() => {
		if (status === 'submitted') {
			return 'size-4 animate-spin';
		}
		return 'size-4';
	});
</script>

<Button class={cn('gap-1.5 rounded-lg', className)} {size} type="submit" {variant} {...props}>
	{#if children}
		{@render children()}
	{:else}
		<!-- <svelte:component this={Icon} class={iconClass} /> -->
		<Icon class={iconClass} />
	{/if}
</Button>
