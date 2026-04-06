<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { onMount, untrack } from 'svelte';
	import { useMotionValue, animate, useReducedMotion } from 'motion-sv';
	import { getTranslate } from '@tolgee/svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	const { t } = getTranslate();
	const reducedMotion = useReducedMotion();

	type LoadingBarProps = WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
		mode: 'progress' | 'loading';
		showBackground?: boolean;
	};

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		mode,
		showBackground = true,
		...restProps
	}: LoadingBarProps = $props();

	const safeMax = $derived(Math.max(max ?? 100, 1));
	const clampedValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
	const progressPercent = $derived((clampedValue / safeMax) * 100);

	const initialWidth = untrack(() => progressPercent);
	const springWidth = useMotionValue(initialWidth);

	let isLoading = $state(untrack(() => mode === 'loading'));
	let lastRequestedMode: 'progress' | 'loading' = untrack(() => mode);
	let springReachedTarget = false;

	let progressStyle = $state(`width: ${initialWidth}%; background: var(--primary);`);
	let rafId: number | null = null;
	let prevSpringWidth = 0;

	// Sync spring toward progressPercent — tween at boundaries to prevent overshoot
	let springAnim: ReturnType<typeof animate> | null = null;
	$effect(() => {
		springAnim?.stop();
		if (reducedMotion.current) {
			springWidth.set(progressPercent);
			springReachedTarget = true;
			progressStyle = `width: ${progressPercent}%; background: var(--primary);`;
			return;
		}
		const atBoundary = progressPercent <= 0 || progressPercent >= 100;
		if (atBoundary) {
			springAnim = animate(springWidth, progressPercent, {
				type: 'tween',
				duration: 0.2,
				ease: [0.23, 1, 0.32, 1]
			});
		} else {
			springAnim = animate(springWidth, progressPercent, {
				type: 'spring',
				stiffness: 300,
				damping: 28
			});
		}
		springReachedTarget = false;
		if (!isLoading) startLoop();
		return () => springAnim?.stop();
	});

	function startLoop() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(renderLoop);
	}

	// Handle mode transitions
	$effect(() => {
		if (mode === lastRequestedMode) return;
		lastRequestedMode = mode;

		if (mode === 'loading') {
			isLoading = true;
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			return;
		}

		// Exit loading: CSS animations stop, progress bar takes over
		isLoading = false;
		startLoop();
	});

	function renderLoop() {
		const progressWidth = Math.max(0, springWidth.get());
		progressStyle = `width: ${progressWidth}%; background: var(--primary);`;

		// Stop loop when spring has settled
		if (!springReachedTarget && Math.abs(progressWidth - prevSpringWidth) < 0.01) {
			springReachedTarget = Math.abs(progressWidth - progressPercent) < 0.1;
		}
		prevSpringWidth = progressWidth;

		if (springReachedTarget && !isLoading) {
			rafId = null;
		} else {
			rafId = requestAnimationFrame(renderLoop);
		}
	}

	onMount(() => {
		if (!isLoading) startLoop();
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
		};
	});
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	aria-label={$t('aria.loading')}
	class={cn(
		'relative h-2 w-full overflow-hidden rounded-full',
		showBackground && 'bg-primary/20',
		className
	)}
	{value}
	{max}
	{...restProps}
>
	<!-- Progress bar (always present, shown when not loading) -->
	<div
		data-slot="progress-indicator"
		class={cn('absolute inset-y-0 transition-opacity', isLoading ? 'opacity-0' : 'opacity-100')}
		style={progressStyle}
	></div>

	<!-- M3 indeterminate bars (CSS-animated, shown when loading) -->
	<div class={cn('absolute inset-0 transition-opacity', isLoading ? 'opacity-100' : 'opacity-0')}>
		<div class="loading-bar primary-bar">
			<div class="loading-bar-inner"></div>
		</div>
		<div class="loading-bar secondary-bar">
			<div class="loading-bar-inner"></div>
		</div>
	</div>
</ProgressPrimitive.Root>

<style>
	/* M3 indeterminate linear progress — exact keyframes from material-web source */
	.loading-bar,
	.loading-bar-inner {
		position: absolute;
	}

	.loading-bar {
		width: 100%;
		height: 100%;
		transform-origin: left center;
	}

	.loading-bar-inner {
		inset: 0;
		background: var(--primary);
	}

	.primary-bar {
		inset-inline-start: -145.167%;
		animation: primary-translate 2s linear infinite;
	}

	.primary-bar > .loading-bar-inner {
		animation: primary-scale 2s linear infinite;
	}

	.secondary-bar {
		inset-inline-start: -54.8889%;
		animation: secondary-translate 2s linear infinite;
	}

	.secondary-bar > .loading-bar-inner {
		animation: secondary-scale 2s linear infinite;
	}

	@keyframes primary-translate {
		0% {
			transform: translateX(0);
		}
		20% {
			animation-timing-function: cubic-bezier(0.5, 0, 0.701732, 0.495819);
			transform: translateX(0);
		}
		59.15% {
			animation-timing-function: cubic-bezier(0.302435, 0.381352, 0.55, 0.956352);
			transform: translateX(83.6714%);
		}
		100% {
			transform: translateX(200.611%);
		}
	}

	@keyframes primary-scale {
		0% {
			transform: scaleX(0.08);
		}
		36.65% {
			animation-timing-function: cubic-bezier(0.334731, 0.12482, 0.785844, 1);
			transform: scaleX(0.08);
		}
		69.15% {
			animation-timing-function: cubic-bezier(0.06, 0.11, 0.6, 1);
			transform: scaleX(0.661479);
		}
		100% {
			transform: scaleX(0.08);
		}
	}

	@keyframes secondary-translate {
		0% {
			animation-timing-function: cubic-bezier(0.15, 0, 0.515058, 0.409685);
			transform: translateX(0);
		}
		25% {
			animation-timing-function: cubic-bezier(0.31033, 0.284058, 0.8, 0.733712);
			transform: translateX(37.6519%);
		}
		48.35% {
			animation-timing-function: cubic-bezier(0.4, 0.627035, 0.6, 0.902026);
			transform: translateX(84.3862%);
		}
		100% {
			transform: translateX(160.278%);
		}
	}

	@keyframes secondary-scale {
		0% {
			animation-timing-function: cubic-bezier(0.205028, 0.057051, 0.57661, 0.453971);
			transform: scaleX(0.08);
		}
		19.15% {
			animation-timing-function: cubic-bezier(0.152313, 0.196432, 0.648374, 1.00432);
			transform: scaleX(0.457104);
		}
		44.15% {
			animation-timing-function: cubic-bezier(0.257759, -0.003163, 0.211762, 1.38179);
			transform: scaleX(0.72796);
		}
		100% {
			transform: scaleX(0.08);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-bar,
		.primary-bar > .loading-bar-inner,
		.secondary-bar,
		.secondary-bar > .loading-bar-inner {
			animation: none;
		}

		.primary-bar {
			inset-inline-start: 0;
		}

		.primary-bar > .loading-bar-inner {
			transform: scaleX(1);
		}

		.secondary-bar {
			display: none;
		}
	}
</style>
