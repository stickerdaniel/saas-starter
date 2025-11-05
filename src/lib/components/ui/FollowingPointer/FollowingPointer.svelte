<script lang="ts">
	import { motion, AnimatePresence } from 'motion-sv';
	import { cn } from '$lib/utils';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		className?: string;
		title?: Snippet;
		children?: Snippet;
	}

	let { className = undefined, title, children }: Props = $props();

	let x = $state(0);
	let y = $state(0);
	let ref = $state<HTMLDivElement | null>(null);
	let rect = $state<DOMRect | null>(null);
	let isInside = $state(false);

	// Long-press state
	let isHolding = $state(false);
	let holdProgress = $state(0);
	let holdStartTime = $state(0);
	let animationFrameId: number | null = null;

	const HOLD_DURATION = 3000; // 3 seconds
	const QUICK_PHASE_DURATION = 100; // 100ms quick start to 5%
	const RIVE_URL = 'https://rive.app/marketplace/3293-6929-spring-demo/';

	const handleMouseMove = (e: MouseEvent) => {
		if (rect) {
			x = e.clientX - rect.left;
			y = e.clientY - rect.top;
		}
	};

	const handleMouseLeave = () => {
		isInside = false;
		// Stop holding if user leaves the area
		if (isHolding) {
			stopHolding();
		}
	};

	const handleMouseEnter = (e: MouseEvent) => {
		// Recalculate bounding rect on every mouse enter to ensure accurate positioning
		if (ref) {
			rect = ref.getBoundingClientRect();
		}
		// Calculate initial position immediately from the enter event
		if (rect) {
			x = e.clientX - rect.left;
			y = e.clientY - rect.top;
		}
		isInside = true;
	};

	// Easing function for smooth progress animation (ease-in-out cubic)
	const easeInOutCubic = (t: number): number => {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	};

	const updateHoldProgress = (timestamp: number) => {
		if (!isHolding) return;

		const elapsed = timestamp - holdStartTime;

		if (elapsed < QUICK_PHASE_DURATION) {
			// Phase 1: Quick linear animation to 5% (0-100ms)
			holdProgress = (elapsed / QUICK_PHASE_DURATION) * 5;
		} else {
			// Phase 2: Eased animation from 5% to 100% (100-3000ms)
			const remainingElapsed = elapsed - QUICK_PHASE_DURATION;
			const remainingDuration = HOLD_DURATION - QUICK_PHASE_DURATION;
			const linearProgress = Math.min(remainingElapsed / remainingDuration, 1);
			const easedProgress = easeInOutCubic(linearProgress);
			holdProgress = 5 + easedProgress * 95;
		}

		if (holdProgress >= 100) {
			// Open link in new tab
			window.open(RIVE_URL, '_blank');
			// Reset
			stopHolding();
		} else {
			animationFrameId = requestAnimationFrame(updateHoldProgress);
		}
	};

	const stopHolding = () => {
		isHolding = false;
		holdProgress = 0;
		if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	};

	const handleBadgeMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		isHolding = true;
		holdStartTime = performance.now();
		animationFrameId = requestAnimationFrame(updateHoldProgress);
	};

	const handleBadgeMouseUp = () => {
		stopHolding();
	};

	// Cleanup on unmount
	onMount(() => {
		return () => {
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
			}
		};
	});
</script>

<div
	bind:this={ref}
	onmouseleave={handleMouseLeave}
	onmouseenter={handleMouseEnter}
	onmousemove={handleMouseMove}
	onmousedown={handleBadgeMouseDown}
	onmouseup={handleBadgeMouseUp}
	style="cursor: none;"
	role="button"
	tabindex="0"
	class={cn('relative', className)}
>
	<AnimatePresence>
		{#if isInside}
			<motion.div
				initial={false}
				animate={{ x, y, scale: isHolding ? 0.95 : 1, opacity: 1 }}
				exit={{ scale: 0, opacity: 0 }}
				style={{ pointerEvents: 'none' }}
				class="absolute z-50 h-4 w-4 rounded-full"
			>
				<svg
					stroke="currentColor"
					fill="currentColor"
					stroke-width="1"
					viewBox="0 0 16 16"
					class="h-6 w-6 -translate-x-[12px] -rotate-[70deg] transform stroke-accent text-accent-foreground dark:stroke-accent-foreground dark:text-accent"
					height="1em"
					width="1em"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"
					></path>
				</svg>
				<motion.div
					initial={{ scale: 0.5, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					exit={{ scale: 0.5, opacity: 0 }}
					style={{ pointerEvents: 'none' }}
					class="relative min-w-max overflow-hidden rounded-full bg-accent p-2 text-xs whitespace-nowrap text-accent-foreground"
				>
					<!-- Progress bar background -->
					<div
						class="absolute inset-0 bg-primary opacity-20"
						style="width: {holdProgress}%; transform-origin: left;"
					></div>

					<!-- Text content -->
					<span class="relative z-10">
						{#if title}
							{@render title()}
						{:else}
							William Shakespeare
						{/if}
					</span>
				</motion.div>
			</motion.div>
		{/if}
	</AnimatePresence>
	{#if children}
		{@render children()}
	{/if}
</div>
