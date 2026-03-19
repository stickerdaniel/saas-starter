<script lang="ts">
	import { motion, AnimatePresence } from 'motion-sv';
	import { getTranslate } from '@tolgee/svelte';
	import { cn } from '$lib/utils';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';

	const { t } = getTranslate();

	interface Props {
		class?: string;
		title?: Snippet;
		children?: Snippet;
	}

	let { class: className = undefined, title, children }: Props = $props();

	let x = $state(0);
	let y = $state(0);
	let ref = $state<HTMLDivElement | null>(null);
	let rect = $state<DOMRect | null>(null);
	let isInside = $state(false);

	// Spring blend transition: 1 = raw mouse (near-instant), 0 = default spring animation
	let mixFactor = $state(0);
	let enterTime = 0;
	const MIX_DURATION = 800; // ms to transition from raw mouse to spring

	// Compute spring transition based on mix factor (exponential interpolation)
	// mix=0: default spring (stiffness: 500, damping: 25) — matches motion-sv underDampedSpring
	// mix=1: overdamped spring (stiffness: 5000, damping: 200) — near-instant mouse following
	const currentTransition = $derived.by(() => {
		const stiffness = 500 * Math.pow(10, mixFactor);
		const damping = 25 * Math.pow(8, mixFactor);
		return {
			x: { type: 'spring' as const, stiffness, damping, restSpeed: 10 },
			y: { type: 'spring' as const, stiffness, damping, restSpeed: 10 }
		};
	});

	// Long-press state
	let isHolding = $state(false);
	let holdProgress = $state(0);
	let holdStartTime = $state(0);
	let animationFrameId: number | null = null;

	const HOLD_DURATION = 3000; // 3 seconds
	const RIVE_URL = 'https://rive.app/marketplace/3293-6929-spring-demo/';

	const handleMouseMove = (e: MouseEvent) => {
		if (rect) {
			x = e.clientX - rect.left;
			y = e.clientY - rect.top;
		}
		// Update blend factor: quadratic ease-out from raw mouse (1) to spring (0)
		const elapsed = performance.now() - enterTime;
		const t = Math.min(elapsed / MIX_DURATION, 1);
		mixFactor = (1 - t) * (1 - t);
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
		// Start blend: cursor matches mouse exactly, then eases into spring animation
		mixFactor = 1;
		enterTime = performance.now();
		isInside = true;
	};

	const updateHoldProgress = (timestamp: number) => {
		if (!isHolding) return;

		const elapsed = timestamp - holdStartTime;
		const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
		holdProgress = progress;

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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={ref}
	role="region"
	aria-label={$t('aria.interactive_pointer_tracking_area')}
	onmouseleave={handleMouseLeave}
	onmouseenter={handleMouseEnter}
	onmousemove={handleMouseMove}
	onmousedown={handleBadgeMouseDown}
	onmouseup={handleBadgeMouseUp}
	style="cursor: none;"
	tabindex="-1"
	class={cn('relative', className)}
>
	<AnimatePresence>
		{#if isInside}
			<motion.div
				initial={false}
				animate={{ x, y, scale: isHolding ? 0.95 : 1, opacity: 1 }}
				transition={currentTransition}
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
						class="absolute inset-0 bg-primary opacity-20 transition-[width]"
						style="width: {holdProgress}%; transform-origin: left; transition-duration: {isHolding
							? '0ms'
							: '150ms'}; transition-timing-function: {isHolding ? 'linear' : 'ease-out'};"
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
