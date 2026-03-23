<script lang="ts">
	import { cn } from '$lib/utils';
	import { buttonVariants } from '$lib/components/ui/button';
	import type { ButtonVariant, ButtonSize } from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithChildren, WithoutChildren } from 'bits-ui';
	import type { ChatStatus } from './attachments-context.svelte.js';
	import SendIcon from './SendIcon.svelte';
	import Loader2Icon from './Loader2Icon.svelte';
	import SquareIcon from './SquareIcon.svelte';
	import XIcon from './XIcon.svelte';

	type PromptSubmitAttrs = WithoutChildren<Omit<HTMLButtonAttributes, 'type'>>;

	type Props = WithChildren<PromptSubmitAttrs> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		status?: ChatStatus;
		ref?: HTMLButtonElement | null;
	};

	let {
		class: className,
		variant = 'default',
		size = 'icon',
		status,
		children,
		...props
	}: Props = $props();
	let buttonProps = $derived(props as PromptSubmitAttrs);

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
			return 'size-4 motion-safe:animate-spin';
		}
		return 'size-4';
	});
</script>

<button
	class={cn(buttonVariants({ variant, size }), 'gap-1.5 rounded-lg', className)}
	type="submit"
	{...buttonProps}
>
	{#if children}
		{@render children()}
	{:else}
		<!-- <svelte:component this={Icon} class={iconClass} /> -->
		<Icon class={iconClass} />
	{/if}
</button>
