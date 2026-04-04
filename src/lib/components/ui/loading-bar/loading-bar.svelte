<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { onMount, untrack } from 'svelte';
	import { useMotionValue, animate, useReducedMotion } from 'motion-sv';
	import { getTranslate } from '@tolgee/svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import {
		ENTER_LOADING_MS,
		EXIT_LOADING_MS,
		advanceLoopingPhase,
		advanceRampedPhase,
		getStripGeometry,
		syncPhaseToProgress
	} from './loading-bar-motion';

	const { t } = getTranslate();

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

	const reducedMotion = useReducedMotion();

	const initialWidth = untrack(() => progressPercent);
	const initialBlend = untrack(() => (mode === 'loading' ? 1 : 0));
	const springWidth = useMotionValue(initialWidth);
	const blendFactor = useMotionValue(initialBlend);

	let shimmerPhase = 0;
	let exitStartTime = 0;
	let lastRequestedMode: 'progress' | 'loading' = untrack(() => mode);
	let springReachedTarget = false;

	let backgroundStyle = $state('');
	let rafId: number | null = null;
	let lastFrameTime = 0;
	let prevSpringWidth = 0;

	// Sync spring toward progressPercent with an explicit spring animation
	let springAnim: ReturnType<typeof animate> | null = null;
	$effect(() => {
		springAnim?.cancel();
		springAnim = animate(springWidth, progressPercent, {
			type: 'spring',
			stiffness: 300,
			damping: 28
		});
		springReachedTarget = false;
	});

	function animateBlendTo(target: number, durationMs: number) {
		if (reducedMotion.current) {
			blendFactor.set(target);
			return;
		}

		animate(blendFactor, target, {
			type: 'tween',
			duration: durationMs / 1000,
			ease: [0.23, 1, 0.32, 1]
		});
	}

	function startLoop() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(renderLoop);
	}

	// Handle mode transitions
	$effect(() => {
		if (mode === lastRequestedMode) return;

		lastRequestedMode = mode;
		lastFrameTime = 0;

		if (mode === 'loading') {
			exitStartTime = 0;
			shimmerPhase = syncPhaseToProgress(springWidth.get());
			animateBlendTo(1, ENTER_LOADING_MS);
			startLoop();
			return;
		}

		// Exit: immediately blend back with gradual speed ramp
		if (reducedMotion.current || blendFactor.get() <= 0.001) {
			exitStartTime = 0;
		} else {
			exitStartTime = performance.now();
		}
		animateBlendTo(0, EXIT_LOADING_MS);
		startLoop();
	});

	function renderLoop(now: number) {
		const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0.016;
		lastFrameTime = now;

		const blend = blendFactor.get();
		const progressWidth = Math.max(0, springWidth.get());

		// Advance shimmer phase when blend > 0
		if (blend > 0.001 && !reducedMotion.current) {
			if (exitStartTime > 0) {
				shimmerPhase = advanceRampedPhase(shimmerPhase, dt, now - exitStartTime);
			} else {
				shimmerPhase = advanceLoopingPhase(shimmerPhase, dt);
			}
		} else {
			exitStartTime = 0;
		}

		if (reducedMotion.current && blend >= 0.5) {
			backgroundStyle = `left: 0%; width: 100%; background: var(--primary);`;
		} else {
			const geometry = getStripGeometry(progressWidth, blend, shimmerPhase);
			backgroundStyle = `left: ${geometry.left}%; width: ${geometry.width}%; background: var(--primary);`;
		}

		// Stop loop when fully idle
		if (!springReachedTarget && Math.abs(progressWidth - prevSpringWidth) < 0.01) {
			springReachedTarget = Math.abs(progressWidth - progressPercent) < 0.1;
		}
		const settled = blend < 0.001 && springReachedTarget && mode === 'progress';
		prevSpringWidth = progressWidth;

		if (settled) {
			rafId = null;
			lastFrameTime = 0;
		} else {
			rafId = requestAnimationFrame(renderLoop);
		}
	}

	$effect(() => {
		void progressPercent;
		void mode;
		startLoop();
	});

	onMount(() => {
		startLoop();
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
	<div data-slot="progress-indicator" class="absolute inset-y-0" style={backgroundStyle}></div>
</ProgressPrimitive.Root>
