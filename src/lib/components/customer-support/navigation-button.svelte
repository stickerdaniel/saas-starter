<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import XIcon from '@lucide/svelte/icons/x';
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
	variant="ghost-tint"
	size="icon-lg"
	shape="pill"
	class={className}
	aria-label={type === 'back' ? $t('aria.go_back') : $t('aria.close')}
	{onclick}
>
	{#if type === 'back'}
		<ChevronLeftIcon class="size-5" />
	{:else}
		<XIcon class="size-5" />
	{/if}
</Button>
