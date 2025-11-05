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
				},
				onLoadError: (error: any) => {
					console.error('Error loading Rive file:', error);
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
		class="absolute top-1/2 left-1/2 z-0 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 bg-white blur-3xl lg:h-[200px] lg:w-[200px]"
	></div>
	<div
		id="spotlight"
		class="absolute top-1/2 left-1/2 z-0 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-[10%] bg-white blur-2xl lg:h-[200px] lg:w-[200px]"
	></div>
	<canvas bind:this={canvas} class="h-full w-full" style="mix-blend-mode: multiply;"></canvas>
</div>
