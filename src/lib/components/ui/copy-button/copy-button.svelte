<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button';
	import { UseClipboard } from '$lib/hooks/use-clipboard.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { cn } from '$lib/utils.js';
	import { getTranslate } from '@tolgee/svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import XIcon from '@lucide/svelte/icons/x';
	import { scale } from 'svelte/transition';
	import type { CopyButtonProps } from './types';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		text,
		icon,
		animationDuration = 500,
		variant = 'ghost',
		size: sizeProp = 'icon',
		onCopy,
		class: className,
		tabindex = 0,
		children,
		...rest
	}: CopyButtonProps = $props();

	const resolvedSize = $derived(sizeProp === 'icon' && children ? 'default' : sizeProp);
	const buttonProps = $derived(
		rest as Omit<import('svelte/elements').HTMLButtonAttributes, 'type'>
	);

	const clipboard = new UseClipboard();
</script>

<button
	{...buttonProps}
	bind:this={ref}
	{tabindex}
	class={cn(buttonVariants({ variant, size: resolvedSize }), 'flex items-center gap-2', className)}
	type="button"
	name="copy"
	onclick={async () => {
		const status = await clipboard.copy(text);
		haptic.trigger(status === 'success' ? 'success' : 'error');
		onCopy?.(status);
	}}
>
	{#if clipboard.status === 'success'}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			<CheckIcon tabindex={-1} />
			<span class="sr-only">{$t('aria.copied')}</span>
		</div>
	{:else if clipboard.status === 'failure'}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			<XIcon tabindex={-1} />
			<span class="sr-only">{$t('aria.copy_failed')}</span>
		</div>
	{:else}
		<div in:scale={{ duration: animationDuration, start: 0.85 }}>
			{#if icon}
				{@render icon()}
			{:else}
				<CopyIcon tabindex={-1} />
			{/if}
			<span class="sr-only">{$t('aria.copy')}</span>
		</div>
	{/if}
	{@render children?.()}
</button>
