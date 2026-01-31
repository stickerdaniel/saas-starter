<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		open: boolean;
		direction?: 'left' | 'right';
		duration?: number;
		class?: string;
		children: Snippet;
	}

	let {
		open = $bindable(),
		direction = 'right',
		duration = 300,
		class: className,
		children
	}: Props = $props();

	// Map duration to Tailwind class (300 is most common, matches current usage)
	let durationClass = $derived(duration === 300 ? 'duration-300' : `duration-[${duration}ms]`);

	// Compute transition classes based on direction and open state
	const slideClasses = $derived.by(() => {
		const baseClasses = 'absolute inset-0 flex flex-col transition-all overflow-hidden';

		if (open) {
			return cn(baseClasses, durationClass, 'translate-x-0 opacity-100', className);
		} else {
			const hideTransform = direction === 'right' ? 'translate-x-full' : '-translate-x-full';
			return cn(
				baseClasses,
				durationClass,
				hideTransform,
				'opacity-0 pointer-events-none',
				className
			);
		}
	});
</script>

<div class={slideClasses}>
	{@render children()}
</div>
