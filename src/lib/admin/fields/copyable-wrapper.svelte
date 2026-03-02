<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { UseClipboard } from '$lib/hooks/use-clipboard.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import ClipboardIcon from '@lucide/svelte/icons/clipboard';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';

	type Props = {
		value: string;
		children: Snippet;
		inline?: boolean;
	};

	let { value, children, inline = true }: Props = $props();

	const { t } = getTranslate();
	const clipboard = new UseClipboard({ delay: 2000 });

	function handleClick(event: MouseEvent) {
		event.stopPropagation();
		clipboard.copy(value);
	}
</script>

<span class="group/copy inline-flex items-center gap-1" class:max-w-full={!inline}>
	{@render children()}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class="inline-flex shrink-0 items-center justify-center rounded p-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/copy:opacity-100"
					onclick={handleClick}
				>
					{#if clipboard.copied}
						<ClipboardCheckIcon class="size-3.5 text-green-600 dark:text-green-400" />
					{:else}
						<ClipboardIcon class="size-3.5 text-muted-foreground" />
					{/if}
					<span class="sr-only">{$t('admin.resources.copy.tooltip')}</span>
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="top">
			{#if clipboard.copied}
				{$t('admin.resources.copy.copied_tooltip')}
			{:else}
				{$t('admin.resources.copy.tooltip')}
			{/if}
		</Tooltip.Content>
	</Tooltip.Root>
</span>
