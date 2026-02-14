<script lang="ts">
	import { cn } from '$lib/utils';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	interface Props {
		class?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { class: className, size = 'md' }: Props = $props();

	const dotSizes = {
		sm: 'h-1 w-1',
		md: 'h-1.5 w-1.5',
		lg: 'h-2 w-2'
	};

	const containerSizes = {
		sm: 'h-4',
		md: 'h-5',
		lg: 'h-6'
	};
</script>

<div class={cn('flex items-center space-x-1', containerSizes[size], className)}>
	{#each Array(3) as _, i (i)}
		<div
			class={cn('animate-[typing_1s_infinite] rounded-full bg-primary', dotSizes[size])}
			style:animation-delay="{i * 250}ms"
		></div>
	{/each}
	<span class="sr-only">{$t('aria.loading')}</span>
</div>
