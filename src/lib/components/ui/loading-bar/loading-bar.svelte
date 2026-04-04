<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { onMount } from 'svelte';
	import { useMotionValue, animate, useReducedMotion } from 'motion-sv';
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
	const springWidth = useMotionValue(initialWidth);

	// Blend factor: 0 = deterministic, 1 = indeterminate
	const blendFactor = useMotionValue(initialBlend);

	// Shimmer phase (0..1), advanced procedurally in the render loop
	let shimmerPhase = 0;
	let pendingExit = false; // waiting for shimmer cycle to complete before blending back

	// Tracks whether the spring has settled at its target (prevents premature loop exit)
	let springReachedTarget = false;

	// The computed inline style, updated each frame
	let backgroundStyle = $state('');
	let rafId: number | null = null;
	let lastFrameTime = 0;
	let prevSpringWidth = 0;
	let lastLogTime = 0; // debug: throttle render loop logs

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

	// Sync spring toward widthPercent with an explicit spring animation
	let springAnim: ReturnType<typeof animate> | null = null;
	$effect(() => {
		console.log(
			`[LoadingBar ${performance.now().toFixed(0)}ms] effect: widthPercent=${widthPercent}, springWidth.current=${springWidth.get().toFixed(1)}`
		);
		springAnim?.cancel();
		springAnim = animate(springWidth, widthPercent, {
			type: 'spring',
			stiffness: 300,
			damping: 28
		});
		springReachedTarget = false;
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
		// Don't freeze shimmer — strips continue forward during blend-back
		// so they converge on deterministic position from the left (no backward sweep)
	}

	// Animate blendFactor when indeterminate changes
	// Asymmetric: entering indeterminate is slower (system working), exiting is snappy (result arrived)
	$effect(() => {
		if (indeterminate) {
			pendingExit = false;

			// Sync shimmer phase so strips start at/ahead of current bar position (no backward sweep)
			// strip1 covers phase 0–0.66, maps via easeOut to position -150..250
			// Invert: find phase where strip1Pos ≥ current bar left edge
			const currentLeft = startPercent + springWidth.get();
			// strip1Pos = lerp(-150, 250, easeOut(phase / 0.66))
			// Solve for phase: easeOut(p/0.66) = (currentLeft - (-150)) / (250 - (-150))
			const normalizedPos = Math.min(Math.max((currentLeft + 150) / 400, 0), 1);
			// Invert easeOut (1-(1-t)^2): t = 1 - sqrt(1 - normalizedPos)
			const rawT = 1 - Math.sqrt(Math.max(1 - normalizedPos, 0));
			shimmerPhase = Math.min(rawT * 0.66, 0.65); // keep in strip1 range

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
		const barW = Math.max(0, springWidth.get());
		const startP = startPercent;

		// Advance shimmer phase when blend > 0 (keeps strips moving forward during blend-back)
		if (blend > 0 && !reducedMotion.current) {
			const prevPhase = shimmerPhase;
			// When exit is pending, gradually ramp speed (ease-in: starts gentle, builds up)
			let speed = 1;
			if (pendingExit) {
				const rampT = Math.min((now - exitStartTime) / (SHIMMER_EXIT_RAMP * 1000), 1);
				const eased = rampT * rampT; // quadratic ease-in
				speed = 1 + (SHIMMER_EXIT_MAX_SPEED - 1) * eased;
			}
			shimmerPhase = (shimmerPhase + (dt * speed) / SHIMMER_PERIOD) % 1;

			// Detect cycle completion (phase wraps around) — start blend-back
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

		// Stop loop when fully idle (blend settled at 0 and spring reached its target)
		if (!springReachedTarget && Math.abs(barW - prevSpringWidth) < 0.01) {
			springReachedTarget = Math.abs(barW - widthPercent) < 0.1;
		}
		const springSettled = blend < 0.001 && springReachedTarget;
		prevSpringWidth = barW;

		// Debug: throttled logging
		if (now - lastLogTime > 500) {
			console.log(
				`[LoadingBar ${now.toFixed(0)}ms] frame: barW=${barW.toFixed(1)}, blend=${blend.toFixed(3)}, settled=${springSettled}, reached=${springReachedTarget}, widthPercent=${widthPercent}`
			);
			lastLogTime = now;
		}

		if (springSettled && !pendingExit) {
			console.log(
				`[LoadingBar ${now.toFixed(0)}ms] loop STOPPED: springReached=${springReachedTarget}, blend=${blend.toFixed(3)}, barW=${barW.toFixed(1)}`
			);
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
