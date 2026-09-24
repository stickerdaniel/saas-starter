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

	const barSizes = {
		sm: { height: '6px', width: '1.5px' },
		md: { height: '8px', width: '2px' },
		lg: { height: '10px', width: '2.5px' }
	};

	const marginLeft = {
		sm: '-0.75px',
		md: '-1px',
		lg: '-1.25px'
	};

	const transformOrigin = {
		sm: '0.75px 10px',
		md: '1px 12px',
		lg: '1.25px 14px'
	};
</script>

<div class={cn('relative', sizeClasses[size], className)}>
	<div class="absolute h-full w-full">
		{#each Array(12) as _, i (i)}
			<div
				class="absolute top-0 left-1/2 ml-(--bar-margin-left) h-(--bar-height) w-(--bar-width) origin-(--bar-origin) transform-(--bar-transform) animate-[spinner-fade_1.2s_linear_infinite] rounded-full bg-primary opacity-0 animation-delay-var motion-reduce:animate-none"
				style:--bar-margin-left={marginLeft[size]}
				style:--bar-origin={transformOrigin[size]}
				style:--bar-transform="rotate({i * 30}deg)"
				style:--delay="{i * 0.1}s"
				style:--bar-height={barSizes[size].height}
				style:--bar-width={barSizes[size].width}
			></div>
		{/each}
	</div>
	<span class="sr-only">{$t('aria.loading')}</span>
</div>
