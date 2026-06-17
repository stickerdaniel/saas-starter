<script lang="ts">
	import { cn } from '$lib/utils';
	import { buttonVariants } from '$lib/components/ui/button';
	import type { ButtonVariant, ButtonSize } from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithChildren, WithoutChildren } from 'bits-ui';
	import type { ChatStatus } from './attachments-context.svelte.js';
	import SendIcon from '@lucide/svelte/icons/send';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SquareIcon from '@lucide/svelte/icons/square';
	import XIcon from '@lucide/svelte/icons/x';

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
			return LoaderCircleIcon;
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
		<Icon class={iconClass} />
	{/if}
</button>
