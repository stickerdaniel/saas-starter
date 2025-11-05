<script lang="ts">
	import { onMount } from 'svelte';
	import { TAILWIND_BREAKPOINTS, useMedia } from '$lib/hooks/use-media.svelte';

	interface RiveBackgroundProps {
		src: string;
		className?: string;
		stateMachine?: string;
	}

	let { src, className = '', stateMachine = 'Motion' }: RiveBackgroundProps = $props();

	const media = useMedia(TAILWIND_BREAKPOINTS);

	let isDark = $state(false);

	onMount(() => {
		// Check if dark mode is active
		isDark = document.documentElement.classList.contains('dark');

		// Watch for theme changes
		const observer = new MutationObserver(() => {
			isDark = document.documentElement.classList.contains('dark');
		});

		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		return () => observer.disconnect();
	});

	const opacity = $derived(isDark ? 1 : media.lg ? 1 : 0.3);

	let canvas: HTMLCanvasElement;
	let riveInstance: any = $state(null);
	let isLoaded = $state(false);

	onMount(() => {
		import('@rive-app/canvas').then((RiveModule) => {
			const Rive = RiveModule.Rive || (RiveModule as any).default || RiveModule;

			riveInstance = new Rive({
				src,
				canvas,
				autoplay: true,
				stateMachines: stateMachine,
				onLoad: () => {
					riveInstance?.resizeDrawingSurfaceToCanvas();
					isLoaded = true;
				},
				onLoadError: (error: any) => {
					console.error('Error loading Rive file:', error);
					isLoaded = true; // Fade out even on error to show content
				}
			});
		});

		return () => {
			riveInstance?.cleanup();
		};
	});
</script>

<div class="pointer-events-none absolute {className}" style="opacity: {opacity};">
	<div
		id="spotlight"
		class="absolute top-1/2 left-1/2 z-0 h-[150px] w-[150px] bg-white blur-3xl transition-transform duration-700 ease-out lg:h-[200px] lg:w-[200px]"
		style="transform: translate(-50%, -50%) scale({isLoaded ? 1 : 0.5});"
	></div>
	<div
		id="spotlight"
		class="absolute top-1/2 left-1/2 z-0 h-[150px] w-[150px] rounded-[10%] bg-white blur-2xl transition-transform duration-700 ease-out lg:h-[200px] lg:w-[200px]"
		style="transform: translate(-50%, -50%) scale({isLoaded ? 1 : 0.5});"
	></div>
	<canvas bind:this={canvas} class="h-full w-full" style="mix-blend-mode: multiply;"></canvas>
	<div
		class="absolute inset-0 bg-background transition-opacity duration-700 ease-out"
		style="opacity: {isLoaded ? 0 : 1};"
	></div>
	{#if !isDark}
		<div
			class="absolute transition-all duration-700 ease-out"
			style="inset: -100%; background: radial-gradient(circle at center, transparent 0%, transparent 20%, rgba(255, 255, 255, 0.95) 35%, rgba(255, 255, 255, 1) 45%); transform: scale({isLoaded
				? 1
				: 0.5}); pointer-events: none;"
		></div>
	{/if}
</div>
