<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		open: boolean;
		direction?: 'left' | 'right';
		duration?: number;
		/** The panel is transparent unless a surface is chosen. */
		surface?: 'none' | 'background' | 'secondary';
		class?: string;
		children: Snippet;
	}

	let {
		open = $bindable(),
		direction = 'right',
		duration = 300,
		surface = 'none',
		class: className,
		children
	}: Props = $props();

	// Map duration to Tailwind class (300 is most common, matches current usage)
	let durationClass = $derived(duration === 300 ? 'duration-300' : `duration-[${duration}ms]`);

	// Compute transition classes based on direction and open state
	const slideClasses = $derived.by(() => {
		const transitionClass =
			duration === 0
				? 'transition-none'
				: `transition-[transform,opacity] ${durationClass} ease-[cubic-bezier(0.23,1,0.32,1)]`;
		const baseClasses = `absolute inset-0 flex flex-col overflow-hidden ${transitionClass}`;

		const surfaceClass = cn(
			surface === 'background' && 'bg-background',
			surface === 'secondary' && 'bg-secondary'
		);

		if (open) {
			return cn(baseClasses, 'translate-x-0 opacity-100', surfaceClass, className);
		} else {
			const hideTransform = direction === 'right' ? 'translate-x-full' : '-translate-x-full';
			return cn(
				baseClasses,
				hideTransform,
				'opacity-0 pointer-events-none',
				surfaceClass,
				className
			);
		}
	});
</script>

<div class={slideClasses}>
	{@render children()}
</div>
