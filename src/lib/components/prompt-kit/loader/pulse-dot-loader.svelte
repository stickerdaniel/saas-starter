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
		sm: 'size-1',
		md: 'size-2',
		lg: 'size-3'
	};
</script>

<div
	class={cn(
		'animate-[pulse-dot_1.2s_ease-in-out_infinite] rounded-full bg-primary',
		sizeClasses[size],
		className
	)}
>
	<span class="sr-only">{$t('aria.loading')}</span>
</div>
