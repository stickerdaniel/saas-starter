<script lang="ts">
	import { cn } from '$lib/utils';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	interface Props {
		class?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { class: className, size = 'md' }: Props = $props();

	const sizeClasses = {
		sm: 'size-4',
		md: 'size-5',
		lg: 'size-6'
	};
</script>

<div
	class={cn(
		'animate-spin rounded-full border-2 border-primary border-t-transparent',
		sizeClasses[size],
		className
	)}
>
	<span class="sr-only">{$t('aria.loading')}</span>
</div>
