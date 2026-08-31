<script lang="ts">
	import { cn } from '$lib/utils';
	import ThinkingStates from '$lib/components/motion/thinking-states.svelte';

	interface Props {
		text: string;
		/** False once the model has stopped and the line is reporting a duration. */
		shimmer?: boolean;
		class?: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { text, shimmer = true, class: className, size = 'md' }: Props = $props();

	const textSizes = {
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-base'
	};
</script>

<ThinkingStates {text} {shimmer} class={cn('font-medium', textSizes[size], className)} />
