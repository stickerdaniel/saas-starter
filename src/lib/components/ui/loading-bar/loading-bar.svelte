<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { onMount } from 'svelte';
	import { useMotionValue, useSpring, animate, useReducedMotion } from 'motion-sv';
	import { getTranslate } from '@tolgee/svelte';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	const { t } = getTranslate();

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
		transitionMs = 250,
		...restProps
	}: LoadingBarProps = $props();

	const safeMax = $derived(Math.max(max ?? 100, 1));
	const clampedStart = $derived(Math.min(Math.max(start, 0), safeMax));
	const clampedValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
	const startPercent = $derived((clampedStart / safeMax) * 100);
	const widthPercent = $derived((Math.max(clampedValue - clampedStart, 0) / safeMax) * 100);

	const reducedMotion = useReducedMotion();

	// --- Animation parameters (blend tree) ---

	// Spring-animated bar width tracking the deterministic value
	// Initial values captured intentionally; $effect handles subsequent updates
	const initialWidth = widthPercent;
	const initialBlend = indeterminate ? 1 : 0;
	const targetWidth = useMotionValue(initialWidth);
	const springWidth = useSpring(targetWidth, { stiffness: 300, damping: 28 });

	// Blend factor: 0 = deterministic, 1 = indeterminate
	const blendFactor = useMotionValue(initialBlend);

	// Shimmer phase (0..1), advanced procedurally in the render loop
	let shimmerPhase = 0;
	let shimmerFrozen = false;
	let pendingExit = false; // waiting for shimmer cycle to complete before blending back

	// High-water mark: bar only moves forward; resets when value drops to 0
	let highWaterMark = 0;

	// The computed inline style, updated each frame
	let backgroundStyle = $state('');
	let rafId: number | null = null;
	let lastFrameTime = 0;
	let prevSpringWidth = 0;

	const SHIMMER_PERIOD = 2; // seconds, base cycle duration
	const SHIMMER_EXIT_MAX_SPEED = 2.5; // peak multiplier during exit ramp
	const SHIMMER_EXIT_RAMP = 0.6; // seconds to reach peak speed (ease-in)
	let exitStartTime = 0; // timestamp when pendingExit was set

	function lerp(a: number, b: number, t: number): number {
		return a + (b - a) * t;
	}

	// Ease-out curve for shimmer strip movement (less mechanical than linear)
	function easeOut(t: number): number {
		return 1 - (1 - t) * (1 - t);
	}

	// Sync spring target when widthPercent changes (forward-only)
	$effect(() => {
		if (widthPercent <= 0) {
			// Reset: new form cycle
			highWaterMark = 0;
			targetWidth.set(0);
		} else {
			highWaterMark = Math.max(highWaterMark, widthPercent);
			targetWidth.set(highWaterMark);
		}
	});

	function blendTowardsDeterministic() {
		const durationSec = (Math.max(0, transitionMs) * 0.72) / 1000;
		if (reducedMotion.current) {
			blendFactor.set(0);
		} else {
			animate(blendFactor, 0, {
				type: 'tween',
				duration: durationSec,
				ease: [0.23, 1, 0.32, 1]
			});
		}
		shimmerFrozen = true;
	}

	// Animate blendFactor when indeterminate changes
	// Asymmetric: entering indeterminate is slower (system working), exiting is snappy (result arrived)
	$effect(() => {
		if (indeterminate) {
			pendingExit = false;
			shimmerFrozen = false;

			const durationSec = Math.max(0, transitionMs) / 1000;
			if (reducedMotion.current) {
				blendFactor.set(1);
			} else {
				animate(blendFactor, 1, {
					type: 'tween',
					duration: durationSec,
					ease: [0.23, 1, 0.32, 1]
				});
			}
		} else if (blendFactor.get() > 0.001) {
			// Exiting: wait for shimmer cycle to complete (gradually accelerated) before blending back
			pendingExit = true;
			exitStartTime = performance.now();
		}
	});

	function renderLoop(now: number) {
		const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0.016;
		lastFrameTime = now;

		const blend = blendFactor.get();
		const barW = springWidth.get();
		const startP = startPercent;

		// Advance shimmer phase only when not frozen and blend > 0
		if (blend > 0 && !shimmerFrozen && !reducedMotion.current) {
			const prevPhase = shimmerPhase;
			// When exit is pending, gradually ramp speed (ease-in: starts gentle, builds up)
			let speed = 1;
			if (pendingExit) {
				const rampT = Math.min((now - exitStartTime) / (SHIMMER_EXIT_RAMP * 1000), 1);
				const eased = rampT * rampT; // quadratic ease-in
				speed = 1 + (SHIMMER_EXIT_MAX_SPEED - 1) * eased;
			}
			shimmerPhase = (shimmerPhase + (dt * speed) / SHIMMER_PERIOD) % 1;

			// Detect cycle completion (phase wraps around)
			if (pendingExit && shimmerPhase < prevPhase) {
				pendingExit = false;
				blendTowardsDeterministic();
			}
		} else if (pendingExit && reducedMotion.current) {
			// Reduced motion: don't wait for cycle, exit immediately
			pendingExit = false;
			blendTowardsDeterministic();
		}

		// Compute shimmer strip positions from phase (ease-out per sweep for organic feel)
		const strip1Pos = shimmerPhase < 0.66 ? lerp(-150, 250, easeOut(shimmerPhase / 0.66)) : 250;
		const strip2Pos =
			shimmerPhase < 0.66 ? -150 : lerp(-150, 250, easeOut((shimmerPhase - 0.66) / 0.34));

		if (reducedMotion.current && blend >= 0.5) {
			// Reduced motion: full-width static bar
			backgroundStyle = `left: 0%; width: 100%; background: var(--primary);`;
		} else if (blend < 0.001) {
			// Pure deterministic
			backgroundStyle = `left: ${startP}%; width: ${barW}%; background: var(--primary);`;
		} else if (blend > 0.999) {
			// Pure indeterminate (two shimmer strips)
			backgroundStyle =
				`background:` +
				` no-repeat linear-gradient(var(--primary) 0 0) ${strip1Pos}% 0 / 60% 100%,` +
				` no-repeat linear-gradient(var(--primary) 0 0) ${strip2Pos}% 0 / 60% 100%;`;
		} else {
			// Blending: strip 1 morphs from deterministic bar, strip 2 fades in
			const s1Left = lerp(startP, strip1Pos, blend);
			const s1Width = lerp(barW, 60, blend);
			const s2Alpha = Math.round(blend * 100);

			backgroundStyle =
				`background:` +
				` no-repeat linear-gradient(var(--primary) 0 0) ${s1Left}% 0 / ${s1Width}% 100%,` +
				` no-repeat linear-gradient(color-mix(in srgb, var(--primary) ${s2Alpha}%, transparent) 0 0) ${strip2Pos}% 0 / 60% 100%;`;
		}

		// Stop loop when fully idle (blend settled at 0 and spring stopped moving)
		const springSettled = blend < 0.001 && Math.abs(barW - prevSpringWidth) < 0.01;
		prevSpringWidth = barW;

		if (springSettled && !pendingExit) {
			rafId = null;
			lastFrameTime = 0;
		} else {
			rafId = requestAnimationFrame(renderLoop);
		}
	}

	function startLoop() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(renderLoop);
	}

	// Restart loop when props change
	$effect(() => {
		// Touch reactive deps to subscribe
		void widthPercent;
		void indeterminate;
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
	<div data-slot="progress-indicator" class="absolute inset-0" style={backgroundStyle}></div>
</ProgressPrimitive.Root>
