<script lang="ts">
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { UseClipboard } from '#lib/hooks/use-clipboard.svelte.ts';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { cn } from '#lib/utils.js';
	import { getTranslate } from '@tolgee/svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import XIcon from '@lucide/svelte/icons/x';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { CopyButtonProps } from './types';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		text,
		icon,
		variant = 'ghost',
		size: sizeProp = 'icon',
		onCopy,
		class: className,
		tabindex = 0,
		children,
		...rest
	}: CopyButtonProps = $props();

	const resolvedSize = $derived(sizeProp === 'icon' && children ? 'default' : sizeProp);
	const buttonProps = $derived(rest as Omit<HTMLButtonAttributes, 'type'>);

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
		<div>
			<CheckIcon tabindex={-1} />
			<span class="sr-only">{$t('aria.copied')}</span>
		</div>
	{:else if clipboard.status === 'failure'}
		<div>
			<XIcon tabindex={-1} />
			<span class="sr-only">{$t('aria.copy_failed')}</span>
		</div>
	{:else}
		<div>
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
