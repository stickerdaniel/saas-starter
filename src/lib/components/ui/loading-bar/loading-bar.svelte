<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	type LoadingBarProps = WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
		start?: number;
		showBackground?: boolean;
		indeterminate?: boolean;
		transitionMs?: number;
	};

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		start = 0,
		showBackground = true,
		indeterminate = false,
		transitionMs = 180,
		...restProps
	}: LoadingBarProps = $props();

	const safeMax = $derived(Math.max(max ?? 100, 1));
	const clampedStart = $derived(Math.min(Math.max(start, 0), safeMax));
	const clampedValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
	const startPercent = $derived((clampedStart / safeMax) * 100);
	const widthPercent = $derived((Math.max(clampedValue - clampedStart, 0) / safeMax) * 100);

	let showDeterministic = $state(false);
	let showIndeterminate = $state(false);
	let deterministicOpacity = $state(0);
	let indeterminateOpacity = $state(0);
	let hasInitialized = $state(false);
	let previousIndeterminate = $state(false);
	let transitionTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	function clearTransitionTimer() {
		if (!transitionTimer) return;
		clearTimeout(transitionTimer);
		transitionTimer = null;
	}

	function syncWithoutTransition(nextIndeterminate: boolean) {
		showDeterministic = !nextIndeterminate;
		showIndeterminate = nextIndeterminate;
		deterministicOpacity = nextIndeterminate ? 0 : 1;
		indeterminateOpacity = nextIndeterminate ? 1 : 0;
	}

	function transitionBetweenModes(nextIndeterminate: boolean) {
		clearTransitionTimer();
		const fadeMs = Math.max(0, transitionMs);

		// Keep both layers mounted during the fade between deterministic and indeterminate states.
		showDeterministic = true;
		showIndeterminate = true;

		if (nextIndeterminate) {
			deterministicOpacity = 0;
			indeterminateOpacity = 1;
			transitionTimer = setTimeout(() => {
				showDeterministic = false;
				transitionTimer = null;
			}, fadeMs);
			return;
		}

		deterministicOpacity = 1;
		indeterminateOpacity = 0;
		transitionTimer = setTimeout(() => {
			showIndeterminate = false;
			transitionTimer = null;
		}, fadeMs);
	}

	$effect(() => {
		if (!hasInitialized) {
			syncWithoutTransition(indeterminate);
			previousIndeterminate = indeterminate;
			hasInitialized = true;
			return () => clearTransitionTimer();
		}

		if (indeterminate !== previousIndeterminate) {
			transitionBetweenModes(indeterminate);
			previousIndeterminate = indeterminate;
		}

		return () => clearTransitionTimer();
	});
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn(
		'relative h-2 w-full overflow-hidden rounded-full',
		showBackground && 'bg-primary/20',
		className
	)}
	{value}
	{max}
	{...restProps}
>
	{#if showIndeterminate}
		<div
			data-slot="progress-indicator"
			class="loading-bar-indeterminate loading-bar-layer absolute inset-0"
			style="opacity: {indeterminateOpacity}; --loading-bar-fade-ms: {Math.max(0, transitionMs)}ms;"
		></div>
	{/if}

	{#if showDeterministic}
		<div
			class="loading-bar-layer absolute inset-0"
			style="opacity: {deterministicOpacity}; --loading-bar-fade-ms: {Math.max(0, transitionMs)}ms;"
		>
			<div
				data-slot="progress-indicator"
				class="absolute inset-y-0 bg-primary transition-[left,width] duration-500"
				style="left: {startPercent}%; width: {widthPercent}%;"
			></div>
		</div>
	{/if}
</ProgressPrimitive.Root>

<style>
	.loading-bar-layer {
		transition-property: opacity;
		transition-duration: var(--loading-bar-fade-ms, 180ms);
		transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
	}

	.loading-bar-indeterminate {
		--loading-bar-color: no-repeat linear-gradient(var(--primary) 0 0);
		background: var(--loading-bar-color), var(--loading-bar-color), transparent;
		background-size: 60% 100%;
		animation: loading-bar-indeterminate 3s infinite;
	}

	@keyframes loading-bar-indeterminate {
		0% {
			background-position:
				-150% 0,
				-150% 0;
		}
		66% {
			background-position:
				250% 0,
				-150% 0;
		}
		100% {
			background-position:
				250% 0,
				250% 0;
		}
	}
</style>
