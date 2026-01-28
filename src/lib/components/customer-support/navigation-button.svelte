<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let {
		type,
		onclick,
		class: className
	}: {
		type: 'close' | 'back';
		onclick: () => void;
		class?: string;
	} = $props();
</script>

<Button
	variant="ghost"
	size="icon"
	class={cn('h-10 w-10 shrink-0 rounded-full hover:!bg-muted-foreground/10', className)}
	aria-label={type === 'back' ? $t('aria.go_back') : $t('aria.close')}
	{onclick}
>
	{#if type === 'back'}
		<ChevronLeftIcon class="size-5" />
	{:else}
		<XIcon class="size-5" />
	{/if}
</Button>
