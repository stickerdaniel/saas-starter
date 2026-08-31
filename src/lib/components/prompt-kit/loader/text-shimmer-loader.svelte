<script lang="ts">
	import { cn } from '$lib/utils';
	import ShimmerText from '$lib/components/motion/shimmer-text.svelte';

	interface Props {
		text?: string;
		class?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { text = 'Thinking', class: className, size = 'md' }: Props = $props();

	const textSizes = {
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-base'
	};
</script>

<ShimmerText {text} class={cn('font-medium', textSizes[size], className)} />
